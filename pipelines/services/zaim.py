"""Zaim API 同期

Zaim API v2 を使用して家計簿データを取得し、raw.zaim_* に保存する。
OAuth 1.0a認証を使用。
"""

import base64
import hashlib
import hmac
import secrets
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials import get_credentials
from pipelines.lib.db import get_supabase_client
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Types
# =============================================================================


class ZaimApiTransaction(TypedDict):
    """Zaim API Transaction レスポンス"""
    id: int
    mode: str  # "payment" | "income" | "transfer"
    user_id: int
    date: str
    category_id: int
    genre_id: int
    from_account_id: int | None
    to_account_id: int | None
    amount: int
    comment: str | None
    name: str | None
    place: str | None
    created: str | None
    modified: str | None
    active: int | None
    receipt_id: int | None


class ZaimApiCategory(TypedDict):
    """Zaim API Category レスポンス"""
    id: int
    name: str
    sort: int
    mode: str  # "payment" | "income"
    active: int


class ZaimApiGenre(TypedDict):
    """Zaim API Genre レスポンス"""
    id: int
    category_id: int
    name: str
    sort: int
    active: int
    parent_genre_id: int | None


class ZaimApiAccount(TypedDict):
    """Zaim API Account レスポンス"""
    id: int
    name: str
    sort: int
    active: int


class DbCategory(TypedDict):
    """raw.zaim_categories テーブルレコード"""
    id: int
    zaim_user_id: int
    name: str
    sort_order: int
    mode: str
    is_active: bool
    synced_at: str


class DbGenre(TypedDict):
    """raw.zaim_genres テーブルレコード"""
    id: int
    zaim_user_id: int
    category_id: int
    name: str
    sort_order: int
    is_active: bool
    synced_at: str


class DbAccount(TypedDict):
    """raw.zaim_accounts テーブルレコード"""
    id: int
    zaim_user_id: int
    name: str
    sort_order: int
    is_active: bool
    synced_at: str


class DbTransaction(TypedDict):
    """raw.zaim_transactions テーブルレコード"""
    zaim_user_id: int
    zaim_id: int
    transaction_type: str
    amount: int
    date: str
    created_at: str
    modified_at: str | None
    category_id: int | None
    genre_id: int | None
    from_account_id: int | None
    to_account_id: int | None
    place: str | None
    name: str | None
    comment: str | None
    is_active: bool
    receipt_id: int | None
    synced_at: str


class OAuth1Credentials(TypedDict):
    """OAuth 1.0a認証情報"""
    consumer_key: str
    consumer_secret: str
    access_token: str
    access_token_secret: str


class SyncStats(TypedDict):
    """同期統計"""
    categories: int
    genres: int
    accounts: int
    transactions: int


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    stats: SyncStats


class FetchResult(TypedDict):
    """データ取得結果"""
    user_id: int
    categories: list[ZaimApiCategory]
    genres: list[ZaimApiGenre]
    accounts: list[ZaimApiAccount]
    transactions: list[ZaimApiTransaction]
    http_requests: int
    elapsed_seconds: float


# =============================================================================
# Configuration
# =============================================================================

BASE_URL = "https://api.zaim.net/v2"

# =============================================================================
# Authentication (OAuth 1.0a)
# =============================================================================

# キャッシュ用変数
_cached_credentials: OAuth1Credentials | None = None


async def load_credentials() -> OAuth1Credentials:
    """OAuth 1.0a認証情報を取得（キャッシュ付き）

    Returns:
        OAuth 1.0a認証情報

    Raises:
        ValueError: 認証情報が不正
    """
    global _cached_credentials
    if _cached_credentials is not None:
        return _cached_credentials

    result = await get_credentials("zaim")
    credentials = result["credentials"]

    required_keys = ["consumer_key", "consumer_secret", "access_token", "access_token_secret"]
    for key in required_keys:
        if key not in credentials:
            raise ValueError(f"Zaim credentials missing {key}")

    _cached_credentials = OAuth1Credentials(
        consumer_key=credentials["consumer_key"],
        consumer_secret=credentials["consumer_secret"],
        access_token=credentials["access_token"],
        access_token_secret=credentials["access_token_secret"],
    )
    return _cached_credentials


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_credentials
    _cached_credentials = None


def generate_oauth_signature(
    method: str,
    url: str,
    params: dict[str, str],
    consumer_secret: str,
    token_secret: str,
) -> str:
    """OAuth 1.0a 署名を生成（HMAC-SHA1）

    Args:
        method: HTTPメソッド
        url: リクエストURL
        params: OAuthパラメータ + クエリパラメータ
        consumer_secret: Consumer Secret
        token_secret: Access Token Secret

    Returns:
        Base64エンコードされた署名
    """
    # パラメータをソートしてエンコード
    sorted_params = sorted(params.items())
    param_string = urllib.parse.urlencode(sorted_params, quote_via=urllib.parse.quote)

    # Signature Base String を作成
    base_string = "&".join([
        method.upper(),
        urllib.parse.quote(url, safe=""),
        urllib.parse.quote(param_string, safe=""),
    ])

    # 署名キーを作成
    signing_key = f"{urllib.parse.quote(consumer_secret, safe='')}&{urllib.parse.quote(token_secret, safe='')}"

    # HMAC-SHA1 で署名
    signature = hmac.new(
        signing_key.encode(),
        base_string.encode(),
        hashlib.sha1,
    ).digest()

    # Base64 エンコード
    return base64.b64encode(signature).decode()


def build_oauth_header(
    method: str,
    url: str,
    credentials: OAuth1Credentials,
    query_params: dict[str, str] | None = None,
) -> str:
    """OAuth 1.0a 認証ヘッダーを構築

    Args:
        method: HTTPメソッド
        url: リクエストURL（クエリパラメータなし）
        credentials: OAuth認証情報
        query_params: クエリパラメータ（署名に含める）

    Returns:
        Authorization ヘッダー値
    """
    # OAuth パラメータ
    oauth_params = {
        "oauth_consumer_key": credentials["consumer_key"],
        "oauth_token": credentials["access_token"],
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_nonce": secrets.token_hex(16),
        "oauth_version": "1.0",
    }

    # 署名用パラメータ（OAuth + クエリパラメータ）
    sign_params = {**oauth_params}
    if query_params:
        sign_params.update(query_params)

    # 署名を生成
    signature = generate_oauth_signature(
        method,
        url,
        sign_params,
        credentials["consumer_secret"],
        credentials["access_token_secret"],
    )
    oauth_params["oauth_signature"] = signature

    # ヘッダー文字列を構築
    header_parts = [f'{k}="{urllib.parse.quote(v, safe="")}"' for k, v in sorted(oauth_params.items())]
    return "OAuth " + ", ".join(header_parts)


# =============================================================================
# API Client
# =============================================================================


async def api_get(
    client: httpx.AsyncClient,
    endpoint: str,
    credentials: OAuth1Credentials,
    params: dict[str, Any] | None = None,
) -> Any:
    """Zaim API GET リクエスト（OAuth 1.0a署名付き）

    Args:
        client: HTTPクライアント
        endpoint: APIエンドポイント（例: "/home/money"）
        credentials: OAuth認証情報
        params: クエリパラメータ

    Returns:
        APIレスポンス

    Raises:
        httpx.HTTPStatusError: APIエラー
    """
    url = f"{BASE_URL}{endpoint}"

    # 署名用にクエリパラメータを文字列に変換
    str_params = {k: str(v) for k, v in (params or {}).items()}

    auth_header = build_oauth_header("GET", url, credentials, str_params)

    response = await client.get(
        url,
        params=params,
        headers={"Authorization": auth_header},
    )
    response.raise_for_status()
    return response.json()


async def fetch_all_data(
    start_date: str,
    end_date: str,
) -> FetchResult:
    """全データを取得（HTTPクライアント共有）

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        FetchResult（データ + リクエスト数 + 実行時間）
    """
    import asyncio

    start_time = time.perf_counter()
    credentials = await load_credentials()
    http_requests = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. ユーザー情報取得（user_idを得るため）
        user_info = await api_get(client, "/home/user/verify", credentials)
        user_id = user_info["me"]["id"]
        http_requests += 1

        # 2. メタデータを並列取得
        cat_task = api_get(client, "/home/category", credentials)
        genre_task = api_get(client, "/home/genre", credentials)
        acc_task = api_get(client, "/home/account", credentials)

        cat_res, genre_res, acc_res = await asyncio.gather(cat_task, genre_task, acc_task)
        http_requests += 3

        categories = cat_res.get("categories", [])
        genres = genre_res.get("genres", [])
        accounts = acc_res.get("accounts", [])

        # 3. トランザクション取得（ページネーション）
        transactions: list[ZaimApiTransaction] = []
        page = 1
        limit = 100
        seen_ids: set[int] = set()

        while True:
            params = {
                "start_date": start_date,
                "end_date": end_date,
                "page": page,
                "limit": limit,
            }
            res = await api_get(client, "/home/money", credentials, params)
            http_requests += 1

            money = res.get("money", [])
            if not money:
                break

            # 重複チェック
            page_ids = [t["id"] for t in money]
            if all(tid in seen_ids for tid in page_ids) and page > 1:
                break

            for tx in money:
                if tx["id"] not in seen_ids:
                    seen_ids.add(tx["id"])
                    transactions.append(tx)

            if len(money) < limit:
                break
            page += 1

    elapsed = time.perf_counter() - start_time

    return FetchResult(
        user_id=user_id,
        categories=categories,
        genres=genres,
        accounts=accounts,
        transactions=transactions,
        http_requests=http_requests,
        elapsed_seconds=round(elapsed, 2),
    )


# =============================================================================
# DB Transformation
# =============================================================================

JST = timezone(timedelta(hours=9))


def convert_zaim_timestamp_to_utc(timestamp: str | None) -> str | None:
    """Zaim APIのJSTタイムスタンプをUTCに変換

    Zaim APIは "2025-11-24 20:43:44" のようにtz情報なしのJST時刻を返す。
    PostgreSQLのtimestamptzに保存するためUTCに変換する。

    Args:
        timestamp: Zaim APIのタイムスタンプ

    Returns:
        ISO8601形式のUTCタイムスタンプ
    """
    if not timestamp:
        return None

    # 既にタイムゾーン情報がある場合はそのまま
    if "+" in timestamp or "Z" in timestamp:
        return timestamp

    # JSTとして解釈してUTCに変換
    # "2025-11-24 20:43:44" -> datetime(JST) -> ISO8601(UTC)
    try:
        dt = datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
        dt_jst = dt.replace(tzinfo=JST)
        return dt_jst.astimezone(timezone.utc).isoformat()
    except ValueError:
        return timestamp


def to_db_category(category: ZaimApiCategory, user_id: int) -> DbCategory:
    """API Category → DB Category"""
    return DbCategory(
        id=category["id"],
        zaim_user_id=user_id,
        name=category["name"],
        sort_order=category["sort"],
        mode=category["mode"],
        is_active=category["active"] == 1,
        synced_at=datetime.now(timezone.utc).isoformat(),
    )


def to_db_genre(genre: ZaimApiGenre, user_id: int) -> DbGenre:
    """API Genre → DB Genre"""
    return DbGenre(
        id=genre["id"],
        zaim_user_id=user_id,
        category_id=genre["category_id"],
        name=genre["name"],
        sort_order=genre["sort"],
        is_active=genre["active"] == 1,
        synced_at=datetime.now(timezone.utc).isoformat(),
    )


def to_db_account(account: ZaimApiAccount, user_id: int) -> DbAccount:
    """API Account → DB Account"""
    return DbAccount(
        id=account["id"],
        zaim_user_id=user_id,
        name=account["name"],
        sort_order=account["sort"],
        is_active=account["active"] == 1,
        synced_at=datetime.now(timezone.utc).isoformat(),
    )


def to_db_transaction(tx: ZaimApiTransaction, user_id: int) -> DbTransaction:
    """API Transaction → DB Transaction

    アカウントID 0 は NULL に変換
    created/modified はJST→UTC変換
    """
    from_account_id = tx.get("from_account_id")
    to_account_id = tx.get("to_account_id")

    return DbTransaction(
        zaim_user_id=user_id,
        zaim_id=tx["id"],
        transaction_type=tx["mode"],
        amount=tx["amount"],
        date=tx["date"],
        created_at=convert_zaim_timestamp_to_utc(tx.get("created")) or datetime.now(timezone.utc).isoformat(),
        modified_at=convert_zaim_timestamp_to_utc(tx.get("modified")),
        category_id=tx.get("category_id") or None,
        genre_id=tx.get("genre_id") or None,
        from_account_id=from_account_id if from_account_id and from_account_id > 0 else None,
        to_account_id=to_account_id if to_account_id and to_account_id > 0 else None,
        place=tx.get("place") or None,
        name=tx.get("name") or None,
        comment=tx.get("comment") or None,
        is_active=tx.get("active") != 0 if tx.get("active") is not None else True,
        receipt_id=tx.get("receipt_id") or None,
        synced_at=datetime.now(timezone.utc).isoformat(),
    )


# =============================================================================
# DB Write
# =============================================================================


async def upsert_categories(categories: list[ZaimApiCategory], user_id: int) -> int:
    """カテゴリを raw.zaim_categories に upsert"""
    if not categories:
        return 0

    records = [to_db_category(c, user_id) for c in categories]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("zaim_categories")
        .upsert(records, on_conflict="zaim_user_id,id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} categories to raw.zaim_categories")
    return saved_count


async def upsert_genres(genres: list[ZaimApiGenre], user_id: int) -> int:
    """ジャンルを raw.zaim_genres に upsert

    注意: category_id への外部キー制約があるため、
    categories の後に実行すること
    """
    if not genres:
        return 0

    records = [to_db_genre(g, user_id) for g in genres]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("zaim_genres")
        .upsert(records, on_conflict="zaim_user_id,id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} genres to raw.zaim_genres")
    return saved_count


async def upsert_accounts(accounts: list[ZaimApiAccount], user_id: int) -> int:
    """口座を raw.zaim_accounts に upsert"""
    if not accounts:
        return 0

    records = [to_db_account(a, user_id) for a in accounts]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("zaim_accounts")
        .upsert(records, on_conflict="zaim_user_id,id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} accounts to raw.zaim_accounts")
    return saved_count


async def upsert_transactions(transactions: list[ZaimApiTransaction], user_id: int) -> int:
    """トランザクションを raw.zaim_transactions に upsert

    transfer モードで from_account_id/to_account_id が不正な場合はスキップ
    """
    if not transactions:
        return 0

    records: list[DbTransaction] = []
    skipped = 0

    for tx in transactions:
        # transfer は両方のアカウントが必要
        if tx["mode"] == "transfer":
            from_acc = tx.get("from_account_id")
            to_acc = tx.get("to_account_id")
            if not from_acc or not to_acc or from_acc <= 0 or to_acc <= 0:
                skipped += 1
                continue

        records.append(to_db_transaction(tx, user_id))

    if skipped > 0:
        logger.info(f"Skipped {skipped} invalid transfer transactions")

    if not records:
        return 0

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("zaim_transactions")
        .upsert(records, on_conflict="zaim_user_id,zaim_id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} transactions to raw.zaim_transactions")
    return saved_count


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_zaim(days: int = 7) -> SyncResult:
    """Zaim データを同期

    Args:
        days: 同期する日数（今日から遡る）

    Returns:
        同期結果
    """
    total_start = time.perf_counter()
    logger.info(f"Starting Zaim sync ({days} days)")

    # 日付範囲を計算
    # endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
    end_date = date.today() + timedelta(days=1)
    # startDate = endDate - (days + 1)
    start_date = end_date - timedelta(days=days + 1)

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    # 1. API からデータ取得
    logger.info(f"Fetching all data ({start_str} to {end_str})...")
    fetch_result = await fetch_all_data(start_str, end_str)
    logger.info(
        f"Fetched {len(fetch_result['categories'])} categories, "
        f"{len(fetch_result['genres'])} genres, "
        f"{len(fetch_result['accounts'])} accounts, "
        f"{len(fetch_result['transactions'])} transactions "
        f"({fetch_result['http_requests']} HTTP requests in {fetch_result['elapsed_seconds']}s)"
    )

    user_id = fetch_result["user_id"]

    # 2. DB に保存（メタデータを先に保存: categories → genres → accounts → transactions）
    db_start = time.perf_counter()
    logger.info("Saving to database...")

    # 外部キー制約の順序に従う
    categories_count = await upsert_categories(fetch_result["categories"], user_id)
    genres_count = await upsert_genres(fetch_result["genres"], user_id)
    accounts_count = await upsert_accounts(fetch_result["accounts"], user_id)
    transactions_count = await upsert_transactions(fetch_result["transactions"], user_id)

    db_elapsed = round(time.perf_counter() - db_start, 2)

    stats = SyncStats(
        categories=categories_count,
        genres=genres_count,
        accounts=accounts_count,
        transactions=transactions_count,
    )

    total_elapsed = round(time.perf_counter() - total_start, 2)

    logger.info(
        f"Zaim sync completed in {total_elapsed}s "
        f"(fetch: {fetch_result['elapsed_seconds']}s, db: {db_elapsed}s): "
        f"{stats['categories']} categories, "
        f"{stats['genres']} genres, "
        f"{stats['accounts']} accounts, "
        f"{stats['transactions']} transactions"
    )

    return SyncResult(
        success=True,
        stats=stats,
    )


# =============================================================================
# CLI Entry Point
# =============================================================================


if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Zaim → Supabase 同期")
    parser.add_argument(
        "--days", "-d",
        type=int,
        default=7,
        help="同期する日数（デフォルト: 7）"
    )
    args = parser.parse_args()

    result = asyncio.run(sync_zaim(days=args.days))
    exit(0 if result["success"] else 1)
