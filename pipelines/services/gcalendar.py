"""Google Calendar API 同期

Google Calendar API v3 を使用してイベントを取得し、raw.gcalendar_events に保存する。
OAuth 2.0 認証を使用（リフレッシュトークンによる自動更新対応）。
"""

import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, TypedDict, Optional

import httpx

from pipelines.lib.credentials_vault import get_credentials, update_credentials
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


class OAuth2Credentials(TypedDict):
    """OAuth 2.0 Credentials"""
    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    scope: Optional[str]
    calendar_id: str


class TokenResponse(TypedDict):
    """Token refresh response"""
    access_token: str
    expires_in: int
    token_type: str
    scope: str


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
DEFAULT_THRESHOLD_MINUTES = 5  # トークン更新の閾値
MAX_RESULTS_PER_PAGE = 2500
JST_OFFSET = "+09:00"

# =============================================================================
# Authentication Cache
# =============================================================================

_auth_cache: Optional[tuple[str, datetime]] = None
_cached_calendar_id: str | None = None


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _auth_cache, _cached_calendar_id
    _auth_cache = None
    _cached_calendar_id = None


# =============================================================================
# OAuth 2.0 Authentication
# =============================================================================


async def refresh_token_from_api(
    client_id: str, client_secret: str, refresh_token: str
) -> TokenResponse:
    """リフレッシュトークンでアクセストークンを更新"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if not response.is_success:
            raise httpx.HTTPStatusError(
                f"Token refresh error: {response.status_code} - {response.text}",
                request=response.request,
                response=response,
            )
        return response.json()


async def get_access_token(force_refresh: bool = False) -> str:
    """アクセストークンを取得（キャッシュ＆自動更新対応）"""
    global _auth_cache, _cached_calendar_id

    # キャッシュが有効ならそれを使用
    if not force_refresh and _auth_cache is not None:
        token, expires_at = _auth_cache
        minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        if minutes_until_expiry > DEFAULT_THRESHOLD_MINUTES:
            logger.info(f"Token valid ({minutes_until_expiry:.0f} min remaining)")
            return token

    # DBから認証情報を取得
    result = await get_credentials("gcalendar")
    if not result:
        raise ValueError("GCalendar credentials not found")

    credentials: OAuth2Credentials = result["credentials"]
    expires_at = result.get("expires_at")

    # calendar_id をキャッシュ
    _cached_calendar_id = credentials.get("calendar_id")

    # 必須フィールドのチェック
    if not credentials.get("client_id") or not credentials.get("client_secret"):
        raise ValueError("Missing client_id or client_secret")
    if not credentials.get("access_token") or not credentials.get("refresh_token"):
        raise ValueError("Missing access_token or refresh_token. Run init_gcalendar_oauth.py first.")

    # リフレッシュが必要かチェック
    needs_refresh = force_refresh
    if not needs_refresh and expires_at:
        minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        needs_refresh = minutes_until_expiry <= DEFAULT_THRESHOLD_MINUTES

    # リフレッシュ不要ならキャッシュして返す
    if not needs_refresh and expires_at:
        logger.info(f"Token valid ({minutes_until_expiry:.0f} min remaining)")
        _auth_cache = (credentials["access_token"], expires_at)
        return credentials["access_token"]

    # トークンをリフレッシュ
    logger.info("Refreshing access token...")
    new_token = await refresh_token_from_api(
        credentials["client_id"],
        credentials["client_secret"],
        credentials["refresh_token"],
    )

    new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=new_token["expires_in"])

    # DBを更新（refresh_tokenは通常変わらないが、念のため保持）
    await update_credentials(
        "gcalendar",
        {
            "access_token": new_token["access_token"],
            "scope": new_token.get("scope"),
        },
        new_expires_at,
    )

    logger.info(f"Token refreshed (expires: {new_expires_at.isoformat()})")
    _auth_cache = (new_token["access_token"], new_expires_at)
    return new_token["access_token"]


async def get_calendar_id() -> str:
    """カレンダーIDを取得"""
    global _cached_calendar_id

    if _cached_calendar_id:
        return _cached_calendar_id

    # トークン取得時にcalendar_idもキャッシュされる
    await get_access_token()

    if not _cached_calendar_id:
        raise ValueError("GCalendar credentials missing calendar_id")
    return _cached_calendar_id


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

    # 認証情報を取得
    access_token = await get_access_token()
    calendar_id = await get_calendar_id()

    # ISO 8601 形式に変換
    time_min = f"{start_date}T00:00:00{JST_OFFSET}"
    time_max = f"{end_date}T23:59:59{JST_OFFSET}"

    all_events: list[GCalEvent] = []
    page_token: str | None = None
    http_requests = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
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

            if response.status_code == 401:
                # トークンが無効な場合、リフレッシュして再試行
                logger.warning("Token expired, refreshing...")
                access_token = await get_access_token(force_refresh=True)
                continue

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
