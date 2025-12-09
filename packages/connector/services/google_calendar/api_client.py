"""Google Calendar API クライアント

OAuth 2.0 認証（リフレッシュトークン）とAPI呼び出しを担当。
データ取得のみを行い、DB操作は行わない。

認証情報:
- Supabase Vault から取得（get_credentials("google_calendar")）
- access_token は自動更新
"""

# ローカル開発時のみ .env を読み込む
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, TypedDict
from urllib.parse import quote

import httpx

from lib.credentials_vault import get_credentials, update_credentials
from lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Configuration
# =============================================================================

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
DEFAULT_THRESHOLD_MINUTES = 5  # トークン更新の閾値
MAX_RESULTS_PER_PAGE = 2500
DEFAULT_RETRY_DELAY_SEC = 1
JST_OFFSET = "+09:00"


# =============================================================================
# Types
# =============================================================================

class AuthInfo(TypedDict):
    """認証情報"""
    access_token: str
    calendar_id: str


class TokenResponse(TypedDict):
    """Token refresh response"""
    access_token: str
    expires_in: int
    token_type: str
    scope: str


# =============================================================================
# Authentication Cache
# =============================================================================

_cached_auth: AuthInfo | None = None
_cached_expires_at: datetime | None = None


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_auth, _cached_expires_at
    _cached_auth = None
    _cached_expires_at = None


# =============================================================================
# Rate Limit Handler
# =============================================================================

async def _handle_rate_limit(response: httpx.Response) -> int:
    """レートリミットレスポンスから待機時間を取得"""
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return int(retry_after)
        except ValueError:
            pass
    return DEFAULT_RETRY_DELAY_SEC


async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
) -> httpx.Response:
    """レートリミット対応のHTTPリクエスト"""
    server_error_retried = False

    while True:
        response = await client.request(method, url, **kwargs)

        if response.status_code < 400:
            return response

        if response.status_code == 429:
            wait_seconds = await _handle_rate_limit(response)
            logger.warning(f"Rate limited (429). Waiting {wait_seconds}s...")
            await asyncio.sleep(wait_seconds)
            continue

        if 500 <= response.status_code < 600:
            if not server_error_retried:
                server_error_retried = True
                logger.warning(f"Server error ({response.status_code}). Retrying once...")
                await asyncio.sleep(DEFAULT_RETRY_DELAY_SEC)
                continue
            response.raise_for_status()

        response.raise_for_status()


# =============================================================================
# OAuth 2.0 Authentication
# =============================================================================

async def _fetch_primary_calendar_id(access_token: str) -> str:
    """CalendarListからprimaryカレンダーのIDを取得

    Args:
        access_token: アクセストークン

    Returns:
        プライマリカレンダーのID（メールアドレス形式）

    Raises:
        ValueError: プライマリカレンダーが見つからない場合
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {access_token}"}
        url = f"{CALENDAR_API_BASE}/users/me/calendarList"

        response = await client.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()

        for item in data.get("items", []):
            if item.get("primary"):
                logger.info(f"Auto-detected primary calendar: {item['id']}")
                return item["id"]

        raise ValueError("Primary calendar not found in CalendarList")


async def _refresh_token_from_api(
    client_id: str,
    client_secret: str,
    refresh_token: str,
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


async def get_auth_info(force_refresh: bool = False) -> AuthInfo:
    """認証情報を取得（キャッシュ＆自動更新対応）

    Returns:
        アクセストークンとカレンダーID
    """
    global _cached_auth, _cached_expires_at

    # キャッシュが有効ならそれを使用
    if not force_refresh and _cached_auth is not None and _cached_expires_at is not None:
        minutes_until_expiry = (_cached_expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        if minutes_until_expiry > DEFAULT_THRESHOLD_MINUTES:
            return _cached_auth

    # DBから認証情報を取得
    result = await get_credentials("google_calendar")
    credentials = result["credentials"]
    expires_at = result.get("expires_at")

    # 必須フィールドのチェック
    if not credentials.get("client_id") or not credentials.get("client_secret"):
        raise ValueError("Missing client_id or client_secret")
    if not credentials.get("access_token") or not credentials.get("refresh_token"):
        raise ValueError("Missing access_token or refresh_token. Run OAuth flow first.")

    # リフレッシュが必要かチェック（calendar_id取得の前に行う）
    needs_refresh = force_refresh
    if not needs_refresh:
        if expires_at is None:
            # expires_atがない場合は安全のためリフレッシュ
            needs_refresh = True
        else:
            minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
            needs_refresh = minutes_until_expiry <= DEFAULT_THRESHOLD_MINUTES

    # リフレッシュが必要な場合、先にトークンを更新
    access_token = credentials["access_token"]
    current_expires_at = expires_at

    if needs_refresh:
        logger.info("Refreshing access token...")
        new_token = await _refresh_token_from_api(
            credentials["client_id"],
            credentials["client_secret"],
            credentials["refresh_token"],
        )

        access_token = new_token["access_token"]
        current_expires_at = datetime.now(timezone.utc) + timedelta(seconds=new_token["expires_in"])

        # DBを更新
        await update_credentials(
            "google_calendar",
            {
                "access_token": access_token,
                "scope": new_token.get("scope"),
            },
            current_expires_at,
        )

        logger.info(f"Token refreshed (expires: {current_expires_at.isoformat()})")

    # calendar_idが未設定の場合、CalendarListからprimaryカレンダーを自動取得
    # （リフレッシュ後の有効なトークンを使用）
    calendar_id = credentials.get("calendar_id")
    if not calendar_id:
        calendar_id = await _fetch_primary_calendar_id(access_token)

    # キャッシュして返す
    _cached_auth = AuthInfo(
        access_token=access_token,
        calendar_id=calendar_id,
    )
    _cached_expires_at = current_expires_at
    return _cached_auth


# =============================================================================
# Calendar API - Events
# =============================================================================

async def fetch_events(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """イベントを取得（ページネーション対応）

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        イベントのリスト（APIレスポンスそのまま）
    """
    auth = await get_auth_info()

    time_min = f"{start_date}T00:00:00{JST_OFFSET}"
    time_max = f"{end_date}T23:59:59{JST_OFFSET}"

    all_events: list[dict[str, Any]] = []
    page_token: str | None = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {auth['access_token']}"}

        while True:
            params: dict[str, Any] = {
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": MAX_RESULTS_PER_PAGE,
                "singleEvents": "true",
                "orderBy": "startTime",
            }
            if page_token:
                params["pageToken"] = page_token

            url = f"{CALENDAR_API_BASE}/calendars/{quote(auth['calendar_id'], safe='')}/events"

            try:
                response = await _request_with_retry(client, "GET", url, params=params, headers=headers)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    # トークン無効、リフレッシュして再試行
                    logger.warning("Token expired, refreshing...")
                    auth = await get_auth_info(force_refresh=True)
                    headers = {"Authorization": f"Bearer {auth['access_token']}"}
                    response = await _request_with_retry(client, "GET", url, params=params, headers=headers)
                else:
                    raise

            data = response.json()

            if data.get("items"):
                # calendar_id をイベントデータに追加
                for item in data["items"]:
                    item["_calendar_id"] = auth["calendar_id"]
                all_events.extend(data["items"])

            page_token = data.get("nextPageToken")
            if not page_token:
                break

            await asyncio.sleep(0.1)

    return all_events


# =============================================================================
# Calendar API - Colors
# =============================================================================

async def fetch_colors() -> dict[str, Any]:
    """カラーパレットを取得

    Returns:
        カラー定義（event, calendar両方含む）
    """
    auth = await get_auth_info()

    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {auth['access_token']}"}
        url = f"{CALENDAR_API_BASE}/colors"

        response = await _request_with_retry(client, "GET", url, headers=headers)
        return response.json()


# =============================================================================
# Calendar API - CalendarList
# =============================================================================

async def fetch_calendar_list() -> list[dict[str, Any]]:
    """カレンダーリストを取得

    Returns:
        カレンダーエントリのリスト
    """
    auth = await get_auth_info()

    all_calendars: list[dict[str, Any]] = []
    page_token: str | None = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {auth['access_token']}"}

        while True:
            params: dict[str, Any] = {"maxResults": 250}
            if page_token:
                params["pageToken"] = page_token

            url = f"{CALENDAR_API_BASE}/users/me/calendarList"
            response = await _request_with_retry(client, "GET", url, params=params, headers=headers)
            data = response.json()

            if data.get("items"):
                all_calendars.extend(data["items"])

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return all_calendars


# =============================================================================
# Calendar API - Calendars
# =============================================================================

async def fetch_calendar(calendar_id: str) -> dict[str, Any]:
    """カレンダーメタデータを取得

    Args:
        calendar_id: カレンダーID

    Returns:
        カレンダーメタデータ
    """
    auth = await get_auth_info()

    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {"Authorization": f"Bearer {auth['access_token']}"}
        url = f"{CALENDAR_API_BASE}/calendars/{quote(calendar_id, safe='')}"

        response = await _request_with_retry(client, "GET", url, headers=headers)
        return response.json()
