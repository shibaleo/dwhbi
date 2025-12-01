"""Google Calendar API 同期

Google Calendar API v3 を使用してイベントを取得し、raw.gcalendar_events に保存する。
Service Account JWT 認証を使用（OAuth不要）。
"""

import base64
import json
import time
from datetime import date, timedelta
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials import get_credentials
from pipelines.lib.db import get_supabase_client
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Types
# =============================================================================


class GCalDateTime(TypedDict, total=False):
    """Google Calendar API DateTime 型"""
    date: str  # YYYY-MM-DD（終日イベント）
    dateTime: str  # ISO 8601（通常イベント）
    timeZone: str


class GCalEvent(TypedDict, total=False):
    """Google Calendar API Event レスポンス型"""
    id: str
    etag: str
    status: str  # confirmed / tentative / cancelled
    htmlLink: str
    created: str
    updated: str
    summary: str
    description: str
    colorId: str
    recurringEventId: str
    start: GCalDateTime
    end: GCalDateTime


class GCalEventsListResponse(TypedDict):
    """Google Calendar API Events.list レスポンス型"""
    kind: str
    etag: str
    summary: str
    updated: str
    timeZone: str
    accessRole: str
    nextPageToken: str | None
    nextSyncToken: str | None
    items: list[GCalEvent]


class ServiceAccountCredentials(TypedDict):
    """Google Service Account Credentials"""
    type: str
    project_id: str
    private_key_id: str
    private_key: str
    client_email: str
    client_id: str
    auth_uri: str
    token_uri: str
    auth_provider_x509_cert_url: str
    client_x509_cert_url: str


class DbEvent(TypedDict):
    """raw.gcalendar_events テーブルレコード"""
    id: str
    calendar_id: str
    summary: str | None
    description: str | None
    start_time: str  # TIMESTAMPTZ
    end_time: str  # TIMESTAMPTZ
    # duration_ms は GENERATED ALWAYS なので書き込み不要
    is_all_day: bool
    color_id: str | None
    status: str | None
    recurring_event_id: str | None
    etag: str | None
    updated: str | None


class FetchResult(TypedDict):
    """データ取得結果"""
    events: list[DbEvent]
    http_requests: int
    elapsed_seconds: float


class SyncStats(TypedDict):
    """同期統計"""
    fetched: int
    upserted: int


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    stats: SyncStats


# =============================================================================
# Configuration
# =============================================================================

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
TOKEN_EXPIRY_SECONDS = 3600  # 1 hour
MAX_RESULTS_PER_PAGE = 2500
JST_OFFSET = "+09:00"

# =============================================================================
# Authentication Cache
# =============================================================================

_cached_access_token: dict[str, Any] | None = None
_cached_calendar_id: str | None = None
_cached_service_account: ServiceAccountCredentials | None = None


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_access_token, _cached_calendar_id, _cached_service_account
    _cached_access_token = None
    _cached_calendar_id = None
    _cached_service_account = None


# =============================================================================
# JWT Authentication
# =============================================================================


def base64url_encode(data: bytes) -> str:
    """Base64URL エンコード（パディングなし）"""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


async def load_service_account() -> tuple[ServiceAccountCredentials, str | None]:
    """credentials.services からサービスアカウント情報を取得（キャッシュ付き）"""
    global _cached_service_account, _cached_calendar_id

    if _cached_service_account is not None:
        return _cached_service_account, _cached_calendar_id

    result = await get_credentials("gcalendar")
    credentials = result["credentials"]

    if "service_account_json" not in credentials:
        raise ValueError("GCalendar credentials missing service_account_json")

    # calendar_id をキャッシュ
    _cached_calendar_id = credentials.get("calendar_id")

    # Base64デコードまたは生JSONをパース
    json_data = credentials["service_account_json"]
    if json_data.strip().startswith("{"):
        json_str = json_data
    else:
        try:
            json_str = base64.b64decode(json_data).decode("utf-8")
        except Exception:
            raise ValueError("Failed to decode service_account_json as Base64")

    try:
        _cached_service_account = json.loads(json_str)
    except json.JSONDecodeError:
        raise ValueError("Failed to parse service_account_json as JSON")

    if not _cached_service_account.get("client_email") or not _cached_service_account.get("private_key"):
        raise ValueError("Invalid credentials: missing client_email or private_key")

    return _cached_service_account, _cached_calendar_id


def create_jwt_sync(credentials: ServiceAccountCredentials) -> str:
    """JWTを生成（RS256署名）- 同期版"""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(time.time())

    header = {"alg": "RS256", "typ": "JWT"}
    payload = {
        "iss": credentials["client_email"],
        "scope": SCOPE,
        "aud": GOOGLE_TOKEN_URL,
        "iat": now,
        "exp": now + TOKEN_EXPIRY_SECONDS,
    }

    header_b64 = base64url_encode(json.dumps(header).encode("utf-8"))
    payload_b64 = base64url_encode(json.dumps(payload).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}"

    # 秘密鍵で署名
    private_key = serialization.load_pem_private_key(
        credentials["private_key"].encode("utf-8"),
        password=None,
    )
    signature = private_key.sign(
        signing_input.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )

    signature_b64 = base64url_encode(signature)
    return f"{signing_input}.{signature_b64}"


async def get_access_token_with_client(client: httpx.AsyncClient) -> str:
    """アクセストークンを取得（キャッシュ付き、クライアント共有版）"""
    global _cached_access_token

    now = time.time()

    # キャッシュが有効なら再利用（5分のマージン）
    if _cached_access_token and _cached_access_token["expires_at"] > now + 300:
        return _cached_access_token["token"]

    credentials, _ = await load_service_account()
    jwt = create_jwt_sync(credentials)

    # JWTをアクセストークンに交換
    response = await client.post(
        GOOGLE_TOKEN_URL,
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    response.raise_for_status()
    token_data = response.json()

    _cached_access_token = {
        "token": token_data["access_token"],
        "expires_at": now + token_data["expires_in"],
    }

    return _cached_access_token["token"]


async def get_access_token() -> str:
    """アクセストークンを取得（キャッシュ付き）- 単独使用版"""
    global _cached_access_token

    now = time.time()

    # キャッシュが有効なら再利用（5分のマージン）
    if _cached_access_token and _cached_access_token["expires_at"] > now + 300:
        return _cached_access_token["token"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        return await get_access_token_with_client(client)


async def get_calendar_id() -> str:
    """カレンダーIDを取得"""
    _, calendar_id = await load_service_account()
    if not calendar_id:
        raise ValueError("GCalendar credentials missing calendar_id")
    return calendar_id


# =============================================================================
# API Client
# =============================================================================


async def fetch_all_events(
    start_date: str,
    end_date: str,
) -> FetchResult:
    """イベントを取得（ページネーション対応）

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        FetchResult（イベント + リクエスト数 + 実行時間）
    """
    import asyncio

    start_time = time.perf_counter()

    # 認証情報をロード
    _, calendar_id = await load_service_account()
    if not calendar_id:
        raise ValueError("GCalendar credentials missing calendar_id")

    # ISO 8601 形式に変換
    time_min = f"{start_date}T00:00:00{JST_OFFSET}"
    time_max = f"{end_date}T23:59:59{JST_OFFSET}"

    all_events: list[GCalEvent] = []
    page_token: str | None = None
    http_requests = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        # トークン取得
        access_token = await get_access_token_with_client(client)
        http_requests += 1

        # イベント取得
        while True:
            params: dict[str, Any] = {
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": MAX_RESULTS_PER_PAGE,
                "singleEvents": "true",
                "orderBy": "startTime",
                "fields": "items(id,etag,status,summary,description,colorId,recurringEventId,start,end,updated),nextPageToken",
            }
            if page_token:
                params["pageToken"] = page_token

            url = f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events"
            response = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            http_requests += 1

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "60")
                raise Exception(f"Rate limited. Retry after {retry_after} seconds.")

            response.raise_for_status()
            data: GCalEventsListResponse = response.json()

            if data.get("items"):
                all_events.extend(data["items"])

            page_token = data.get("nextPageToken")
            if not page_token:
                break

            await asyncio.sleep(0.1)

    db_events = [to_db_event(event, calendar_id) for event in all_events]
    elapsed = time.perf_counter() - start_time

    return FetchResult(
        events=db_events,
        http_requests=http_requests,
        elapsed_seconds=round(elapsed, 2),
    )


# =============================================================================
# Transform Functions (API → DB)
# =============================================================================


def to_db_event(event: GCalEvent, calendar_id: str) -> DbEvent:
    """API型 → DB型への変換

    終日イベントと通常イベントで異なるフィールドを統一形式に変換。
    """
    start = event.get("start", {})
    end = event.get("end", {})

    # 終日イベントの場合は date を TIMESTAMPTZ に変換
    start_time = start.get("dateTime") or f"{start.get('date')}T00:00:00{JST_OFFSET}"
    end_time = end.get("dateTime") or f"{end.get('date')}T00:00:00{JST_OFFSET}"
    is_all_day = "dateTime" not in start

    return DbEvent(
        id=event["id"],
        calendar_id=calendar_id,
        summary=event.get("summary"),
        description=event.get("description"),
        start_time=start_time,
        end_time=end_time,
        is_all_day=is_all_day,
        color_id=event.get("colorId"),
        status=event.get("status"),
        recurring_event_id=event.get("recurringEventId"),
        etag=event.get("etag"),
        updated=event.get("updated"),
    )


# =============================================================================
# Database Operations
# =============================================================================


async def upsert_events(events: list[DbEvent]) -> int:
    """イベントを raw.gcalendar_events に upsert

    Args:
        events: DBレコード形式のイベントリスト

    Returns:
        保存件数
    """
    if not events:
        return 0

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("gcalendar_events")
        .upsert(events, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} events to raw.gcalendar_events")
    return saved_count


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_gcalendar(days: int = 7) -> SyncResult:
    """Google Calendar データを同期

    Args:
        days: 同期する日数（今日から遡る、デフォルト7日）

    Returns:
        同期結果
    """
    total_start = time.perf_counter()
    logger.info(f"Starting Google Calendar sync ({days} days)")

    # 日付範囲を計算
    # endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
    end_date = date.today() + timedelta(days=1)
    start_date = end_date - timedelta(days=days + 1)

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    # 1. API からデータ取得
    logger.info(f"Fetching events ({start_str} to {end_str})...")
    fetch_result = await fetch_all_events(start_str, end_str)
    logger.info(
        f"Fetched {len(fetch_result['events'])} events "
        f"({fetch_result['http_requests']} HTTP requests in {fetch_result['elapsed_seconds']}s)"
    )

    # 2. DB に保存
    db_start = time.perf_counter()
    logger.info("Saving to database...")
    upserted_count = await upsert_events(fetch_result["events"])
    db_elapsed = round(time.perf_counter() - db_start, 2)

    stats = SyncStats(
        fetched=len(fetch_result["events"]),
        upserted=upserted_count,
    )

    total_elapsed = round(time.perf_counter() - total_start, 2)

    logger.info(
        f"Google Calendar sync completed in {total_elapsed}s "
        f"(fetch: {fetch_result['elapsed_seconds']}s, db: {db_elapsed}s): "
        f"{stats['fetched']} fetched, {stats['upserted']} upserted"
    )

    return SyncResult(
        success=True,
        stats=stats,
    )
