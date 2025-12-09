"""Tanita Health Planet 同期モジュール

Tanita Health Planet API から体組成データを取得し、Supabase の raw スキーマに保存する。

OAuth 2.0フロー:
1. 初回認証（手動、ブラウザ経由）でauthorization_codeを取得
2. authorization_codeでaccess_token取得
3. access_token有効期限切れ時にrefresh_tokenで自動更新

API仕様:
- Base URL: https://www.healthplanet.jp/
- OAuth 2.0: Authorization Code Flow
- トークン有効期限: access_token 3時間、refresh_token 60日
- レート制限: 明示的な記載なし（控えめに実行）
- データ取得制限: 3ヶ月/リクエスト
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from time import time
from typing import TypedDict
from zoneinfo import ZoneInfo

import httpx

from lib.credentials_vault import get_credentials, update_credentials
from lib.db import get_supabase_client
from lib.logger import setup_logger

# ロガー設定
logger = setup_logger("tanita")

# =============================================================================
# 型定義
# =============================================================================


class OAuth2Credentials(TypedDict):
    """OAuth 2.0認証情報"""

    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    scope: str


class TokenResponse(TypedDict):
    """トークンレスポンス"""

    access_token: str
    refresh_token: str
    expires_in: int  # 秒
    token_type: str


class TanitaApiMeasurement(TypedDict):
    """Tanita API測定データ（1レコード）

    API仕様書より:
    - date: 測定日付 (yyyyMMddHHmm)
    - keydata: 測定データ（値）
    - model: 測定機器名
    - tag: 測定部位（6021=体重、6022=体脂肪率）
    """

    date: str  # yyyyMMddHHmm (12桁)
    keydata: str  # 測定データ（値）
    model: str  # 測定機器名
    tag: str  # 測定部位タグ（6021=体重、6022=体脂肪率）


class DbBodyComposition(TypedDict):
    """DB保存用体組成データ

    NOTE: 6023-6029は2020/6/29で連携終了。現在取得可能なのは体重と体脂肪率のみ。
    DBスキーマ: raw.tanita_body_composition
    """

    measured_at: str  # ISO8601 UTC
    weight: float | None  # 体重 (kg)
    body_fat_percent: float | None  # 体脂肪率 (%)
    model: str
    synced_at: str  # DBカラム名に合わせる


class DbBloodPressure(TypedDict):
    """DB保存用血圧データ

    DBスキーマ: raw.tanita_blood_pressure
    API: /status/sphygmomanometer.json
    """

    measured_at: str  # ISO8601 UTC
    systolic: int | None  # 最高血圧 (mmHg) - tag: 622E
    diastolic: int | None  # 最低血圧 (mmHg) - tag: 622F
    pulse: int | None  # 脈拍 (bpm) - tag: 6230
    model: str
    synced_at: str


class SyncResult(TypedDict):
    """同期結果"""

    success: bool
    records: int
    error: str | None


# =============================================================================
# グローバル変数
# =============================================================================

# OAuth 2.0トークンキャッシュ（プロセス内）
_auth_cache: tuple[str, datetime] | None = None  # (access_token, expires_at)

# 測定項目タグマッピング（体組成）
# NOTE: 6023-6029は2020/6/29で連携終了。現在取得可能なのは6021, 6022のみ
# DBカラム名に合わせる（weight, body_fat_percent）
BODY_COMPOSITION_TAG_MAP = {
    "6021": "weight",  # 体重 (kg)
    "6022": "body_fat_percent",  # 体脂肪率 (%)
}

# 測定項目タグマッピング（血圧）
# API: /status/sphygmomanometer.json
BLOOD_PRESSURE_TAG_MAP = {
    "622E": "systolic",  # 最高血圧 (mmHg)
    "622F": "diastolic",  # 最低血圧 (mmHg)
    "6230": "pulse",  # 脈拍 (bpm)
}

# =============================================================================
# Helper Functions
# =============================================================================


def format_tanita_date(dt: datetime) -> str:
    """datetimeをTanita API形式（yyyyMMddHHmmss）に変換

    Args:
        dt: datetimeオブジェクト

    Returns:
        "20251130000000"形式の文字列（14桁）
    """
    return dt.strftime("%Y%m%d%H%M%S")


def parse_tanita_date(date_str: str) -> str:
    """Tanita API日付をISO8601 UTCに変換

    Args:
        date_str: "201008200628"形式（12桁、JST想定）

    Returns:
        ISO8601 UTC文字列
    """
    # APIレスポンスは12桁（yyyyMMddHHmm）
    if len(date_str) == 12:
        dt_naive = datetime.strptime(date_str, "%Y%m%d%H%M")
    elif len(date_str) == 14:
        dt_naive = datetime.strptime(date_str, "%Y%m%d%H%M%S")
    else:
        raise ValueError(f"Invalid date format: {date_str}")

    dt_jst = dt_naive.replace(tzinfo=ZoneInfo("Asia/Tokyo"))
    dt_utc = dt_jst.astimezone(timezone.utc)
    return dt_utc.isoformat()


def generate_periods(
    start: datetime, end: datetime, max_days: int = 90
) -> list[tuple[datetime, datetime]]:
    """期間を最大日数ごとに分割

    Args:
        start: 開始日時
        end: 終了日時
        max_days: 最大日数（デフォルト90日=3ヶ月）

    Returns:
        (start, end)のタプルリスト
    """
    periods = []
    current_start = start

    while current_start < end:
        current_end = min(current_start + timedelta(days=max_days), end)
        periods.append((current_start, current_end))
        current_start = current_end

    return periods


# =============================================================================
# Authentication
# =============================================================================


async def get_access_token() -> str:
    """アクセストークンを取得（キャッシュ or リフレッシュ）

    Returns:
        アクセストークン

    Note:
        - グローバル変数 _auth_cache でプロセス内キャッシュ
        - 有効期限30分前にリフレッシュ（access_tokenの有効期限は3時間）
    """
    global _auth_cache

    # キャッシュチェック
    if _auth_cache:
        access_token, expires_at = _auth_cache
        remaining_minutes = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60

        if remaining_minutes > 30:  # 30分以上有効なら使用
            logger.info(f"Token valid ({int(remaining_minutes)} min remaining)")
            return access_token

    # DBから認証情報取得
    creds_data = await get_credentials("tanita")
    credentials: OAuth2Credentials = creds_data["credentials"]
    expires_at: datetime = creds_data["expires_at"]

    # 有効期限チェック（30分閾値）
    remaining_minutes = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60

    if remaining_minutes > 30:
        # トークン有効
        _auth_cache = (credentials["access_token"], expires_at)
        logger.info(f"Token valid ({int(remaining_minutes)} min remaining)")
        return credentials["access_token"]

    # トークンリフレッシュ
    logger.info("Refreshing access token...")
    token_response = await refresh_token_from_api(
        credentials["client_id"],
        credentials["client_secret"],
        credentials["refresh_token"],
    )

    # 新しい認証情報を保存
    new_credentials: OAuth2Credentials = {
        "client_id": credentials["client_id"],
        "client_secret": credentials["client_secret"],
        "access_token": token_response["access_token"],
        "refresh_token": token_response["refresh_token"],
        "scope": credentials["scope"],
    }

    new_expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=token_response["expires_in"]
    )

    await update_credentials("tanita", new_credentials, new_expires_at)

    # キャッシュ更新
    _auth_cache = (token_response["access_token"], new_expires_at)
    logger.info("Token refreshed successfully")

    return token_response["access_token"]


async def refresh_token_from_api(
    client_id: str, client_secret: str, refresh_token: str
) -> TokenResponse:
    """Tanita OAuth 2.0 トークンリフレッシュ

    Args:
        client_id: クライアントID
        client_secret: クライアントシークレット
        refresh_token: リフレッシュトークン

    Returns:
        トークンレスポンス

    Raises:
        httpx.HTTPStatusError: API呼び出し失敗
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://www.healthplanet.jp/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if not response.is_success:
            logger.error(f"Token refresh failed: {response.status_code} {response.text}")
            response.raise_for_status()

        data = response.json()

        return TokenResponse(
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_in=data["expires_in"],
            token_type=data["token_type"],
        )


# =============================================================================
# API Data Fetching
# =============================================================================


def _parse_api_response(response: httpx.Response) -> dict:
    """APIレスポンスをパースする共通関数

    Args:
        response: HTTPレスポンス

    Returns:
        パースされたJSONデータ
    """
    # デバッグ: レスポンスの内容を確認
    logger.debug(f"Response headers: {response.headers}")
    logger.debug(f"Response content (first 500 bytes): {response.content[:500]}")

    # Tanita APIはShift_JISでレスポンスを返す場合がある
    # Content-Typeヘッダーでエンコーディングを確認
    content_type = response.headers.get("content-type", "")
    if "shift_jis" in content_type.lower() or "sjis" in content_type.lower():
        content = response.content.decode("shift_jis")
        data = json.loads(content)
    else:
        try:
            data = response.json()
        except UnicodeDecodeError:
            # Shift_JISとしてデコードを試みる
            content = response.content.decode("shift_jis")
            data = json.loads(content)

    # デバッグ: レスポンス全体を確認
    logger.debug(f"API response: {data}")

    return data


def _extract_measurements(data: dict, endpoint_name: str) -> list[TanitaApiMeasurement]:
    """APIレスポンスから測定データを抽出

    Args:
        data: パースされたAPIレスポンス
        endpoint_name: エンドポイント名（ログ用）

    Returns:
        測定データのリスト
    """
    # エラーチェック
    # 正常レスポンスの場合は "status" キーがないか、"0" を返す
    status = data.get("status")
    if status is not None and status != "0":
        error_msg = data.get("error", f"Unknown error (status={status})")
        logger.error(f"{endpoint_name} API error: {error_msg}")
        logger.error(f"Full response: {data}")
        return []

    return data.get("data", [])


async def fetch_body_composition(
    client: httpx.AsyncClient, access_token: str, start: datetime, end: datetime
) -> list[TanitaApiMeasurement]:
    """体組成データ取得

    Args:
        client: HTTPクライアント
        access_token: アクセストークン
        start: 開始日時
        end: 終了日時

    Returns:
        測定データのリスト

    API仕様:
        GET https://www.healthplanet.jp/status/innerscan.json
        - date: 0=最新, 1=開始日指定
        - from: yyyyMMddHHmmss
        - to: yyyyMMddHHmmss
        - tag: 6021, 6022
    """
    params = {
        "access_token": access_token,
        "date": "1",  # 期間指定
        "from": format_tanita_date(start),
        "to": format_tanita_date(end),
        "tag": ",".join(BODY_COMPOSITION_TAG_MAP.keys()),
    }

    response = await client.get(
        "https://www.healthplanet.jp/status/innerscan.json", params=params
    )
    response.raise_for_status()

    data = _parse_api_response(response)
    return _extract_measurements(data, "innerscan")


async def fetch_blood_pressure(
    client: httpx.AsyncClient, access_token: str, start: datetime, end: datetime
) -> list[TanitaApiMeasurement]:
    """血圧データ取得

    Args:
        client: HTTPクライアント
        access_token: アクセストークン
        start: 開始日時
        end: 終了日時

    Returns:
        測定データのリスト

    API仕様:
        GET https://www.healthplanet.jp/status/sphygmomanometer.json
        - date: 0=最新, 1=開始日指定
        - from: yyyyMMddHHmmss
        - to: yyyyMMddHHmmss
        - tag: 622E, 622F, 6230
    """
    params = {
        "access_token": access_token,
        "date": "1",  # 期間指定
        "from": format_tanita_date(start),
        "to": format_tanita_date(end),
        "tag": ",".join(BLOOD_PRESSURE_TAG_MAP.keys()),
    }

    response = await client.get(
        "https://www.healthplanet.jp/status/sphygmomanometer.json", params=params
    )
    response.raise_for_status()

    data = _parse_api_response(response)
    return _extract_measurements(data, "sphygmomanometer")


# =============================================================================
# Data Transformation
# =============================================================================


def to_db_body_composition(
    measurements: list[TanitaApiMeasurement],
) -> list[DbBodyComposition]:
    """体組成測定データをDB形式に変換

    Args:
        measurements: API測定データリスト

    Returns:
        DB保存用データリスト

    Note:
        - 同じ日時の測定を1レコードにまとめる
        - 測定項目（tag）を対応するフィールドにマッピング
        - API仕様: keydata = 測定値、tag = 測定部位
    """
    # 日時ごとにグループ化
    grouped: dict[str, dict] = {}

    for m in measurements:
        date_key = m["date"]

        if date_key not in grouped:
            grouped[date_key] = {
                "measured_at": parse_tanita_date(m["date"]),
                "model": m["model"],
                "weight": None,
                "body_fat_percent": None,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }

        # 測定値をマッピング（keydata が測定値）
        field_name = BODY_COMPOSITION_TAG_MAP.get(m["tag"])
        if field_name:
            grouped[date_key][field_name] = float(m["keydata"])

    return list(grouped.values())


def to_db_blood_pressure(
    measurements: list[TanitaApiMeasurement],
) -> list[DbBloodPressure]:
    """血圧測定データをDB形式に変換

    Args:
        measurements: API測定データリスト

    Returns:
        DB保存用データリスト

    Note:
        - 同じ日時の測定を1レコードにまとめる
        - 測定項目（tag）を対応するフィールドにマッピング
        - API仕様: keydata = 測定値、tag = 測定部位
    """
    # 日時ごとにグループ化
    grouped: dict[str, dict] = {}

    for m in measurements:
        date_key = m["date"]

        if date_key not in grouped:
            grouped[date_key] = {
                "measured_at": parse_tanita_date(m["date"]),
                "model": m["model"],
                "systolic": None,
                "diastolic": None,
                "pulse": None,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }

        # 測定値をマッピング（keydata が測定値、血圧は整数）
        field_name = BLOOD_PRESSURE_TAG_MAP.get(m["tag"])
        if field_name:
            grouped[date_key][field_name] = int(float(m["keydata"]))

    return list(grouped.values())


# =============================================================================
# Database Operations
# =============================================================================


async def upsert_body_composition(records: list[DbBodyComposition]) -> int:
    """体組成データをupsert

    Args:
        records: DB保存用データリスト

    Returns:
        保存件数

    Note:
        - 主キー: measured_at
        - 重複時は全カラム更新
    """
    if not records:
        return 0

    client = get_supabase_client()
    logger.info(f"Saving body composition... ({len(records)} records)")

    response = (
        client.schema("raw")
        .table("tanita_body_composition")
        .upsert(records, on_conflict="measured_at")
        .execute()
    )

    if hasattr(response, "error") and response.error:
        logger.error(f"Failed to upsert body composition: {response.error}")
        raise Exception(response.error)

    logger.info(f"Saved {len(records)} body composition records")
    return len(records)


async def upsert_blood_pressure(records: list[DbBloodPressure]) -> int:
    """血圧データをupsert

    Args:
        records: DB保存用データリスト

    Returns:
        保存件数

    Note:
        - 主キー: measured_at
        - 重複時は全カラム更新
    """
    if not records:
        return 0

    client = get_supabase_client()
    logger.info(f"Saving blood pressure... ({len(records)} records)")

    response = (
        client.schema("raw")
        .table("tanita_blood_pressure")
        .upsert(records, on_conflict="measured_at")
        .execute()
    )

    if hasattr(response, "error") and response.error:
        logger.error(f"Failed to upsert blood pressure: {response.error}")
        raise Exception(response.error)

    logger.info(f"Saved {len(records)} blood pressure records")
    return len(records)


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_tanita(days: int = 3) -> SyncResult:
    """Tanita データ同期（体組成 + 血圧）

    Args:
        days: 同期する日数（デフォルト3日）

    Returns:
        同期結果

    処理フロー:
        1. アクセストークン取得（キャッシュ or リフレッシュ）
        2. 期間を3ヶ月ごとに分割
        3. 各期間の測定データ取得（体組成 + 血圧）
        4. DB形式に変換
        5. upsert
    """
    try:
        logger.info(f"Starting Tanita sync ({days} days)")

        # 1. アクセストークン取得
        access_token = await get_access_token()

        # 2. 期間設定（JST 00:00:00基準）
        now_jst = datetime.now(ZoneInfo("Asia/Tokyo")).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        start = now_jst - timedelta(days=days)
        end = now_jst + timedelta(days=1)  # 明日の00:00（今日を含む）

        # 3. 期間を3ヶ月ごとに分割
        periods = generate_periods(start, end, max_days=90)
        logger.info(f"Fetching {len(periods)} period(s)")

        # 4. データ取得（逐次処理、レート制限考慮）
        all_body_composition: list[TanitaApiMeasurement] = []
        all_blood_pressure: list[TanitaApiMeasurement] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            for period_start, period_end in periods:
                # 体組成データ取得
                body_comp = await fetch_body_composition(
                    client, access_token, period_start, period_end
                )
                all_body_composition.extend(body_comp)
                logger.info(
                    f"Fetched {len(body_comp)} body composition measurements "
                    f"({period_start.date()} to {period_end.date()})"
                )

                # レート制限回避
                await asyncio.sleep(0.5)

                # 血圧データ取得
                blood_press = await fetch_blood_pressure(
                    client, access_token, period_start, period_end
                )
                all_blood_pressure.extend(blood_press)
                logger.info(
                    f"Fetched {len(blood_press)} blood pressure measurements "
                    f"({period_start.date()} to {period_end.date()})"
                )

                # レート制限回避のため、複数期間がある場合は少し待機
                if len(periods) > 1:
                    await asyncio.sleep(1)

        logger.info(
            f"Total: {len(all_body_composition)} body composition, "
            f"{len(all_blood_pressure)} blood pressure"
        )

        # 5. データ変換
        body_comp_records = to_db_body_composition(all_body_composition)
        blood_press_records = to_db_blood_pressure(all_blood_pressure)
        logger.info(
            f"Converted to {len(body_comp_records)} body composition, "
            f"{len(blood_press_records)} blood pressure records"
        )

        # 6. DB保存
        saved_body_comp = await upsert_body_composition(body_comp_records)
        saved_blood_press = await upsert_blood_pressure(blood_press_records)
        total_saved = saved_body_comp + saved_blood_press

        logger.info(
            f"Sync completed: {saved_body_comp} body composition, "
            f"{saved_blood_press} blood pressure records"
        )

        return SyncResult(success=True, records=total_saved, error=None)

    except Exception as e:
        logger.error(f"Sync failed: {e}")
        return SyncResult(success=False, records=0, error=str(e))


# =============================================================================
# CLI Entry Point
# =============================================================================


async def main():
    """CLIエントリーポイント"""
    result = await sync_tanita(days=3)

    if result["success"]:
        print(f"[OK] Sync successful: {result['records']} records")
    else:
        print(f"[ERROR] Sync failed: {result['error']}")
        exit(1)


if __name__ == "__main__":
    asyncio.run(main())
