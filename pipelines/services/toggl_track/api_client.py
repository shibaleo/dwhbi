"""Toggl Track API クライアント

Track API v9 および Reports API v3 への認証・HTTPリクエストを担当。
データ取得のみを行い、DB操作は行わない。

レートリミット対応:
- 429エラー時はRetry-Afterヘッダーを確認して待機
- デフォルトは1秒待機
"""

# ローカル開発時のみ .env を読み込む
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import asyncio
import base64
from datetime import date, timedelta
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials_vault import get_credentials
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Configuration
# =============================================================================

TRACK_API_BASE = "https://api.track.toggl.com/api/v9"
REPORTS_API_BASE = "https://api.track.toggl.com/reports/api/v3"
DEFAULT_RETRY_DELAY_SEC = 1


# =============================================================================
# Rate Limit Handler
# =============================================================================

async def _handle_rate_limit(response: httpx.Response) -> int:
    """レートリミットレスポンスから待機時間を取得

    Args:
        response: HTTPレスポンス

    Returns:
        待機秒数
    """
    # Retry-Afterヘッダーを確認（秒数）
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return int(retry_after)
        except ValueError:
            pass

    # X-RateLimit-Reset ヘッダーを確認（Unix timestamp）
    reset_time = response.headers.get("X-RateLimit-Reset")
    if reset_time:
        try:
            import time
            wait_seconds = int(reset_time) - int(time.time())
            if wait_seconds > 0:
                return wait_seconds
        except ValueError:
            pass

    return DEFAULT_RETRY_DELAY_SEC


async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
) -> httpx.Response:
    """レートリミット対応のHTTPリクエスト

    リトライポリシー:
    - 429 (Rate Limit): 適切な時間待機してリトライ（無制限）
    - 4xx (その他): 即座にエラー
    - 5xx (Server Error): 1回だけリトライ

    Args:
        client: HTTPクライアント
        method: HTTPメソッド（GET, POST等）
        url: リクエストURL
        **kwargs: その他のリクエストパラメータ

    Returns:
        HTTPレスポンス

    Raises:
        httpx.HTTPStatusError: エラー発生時
    """
    server_error_retried = False

    while True:
        response = await client.request(method, url, **kwargs)

        # 成功 (2xx, 3xx)
        if response.status_code < 400:
            return response

        # レートリミット (429) - 適切な時間待機してリトライ
        if response.status_code == 429:
            wait_seconds = await _handle_rate_limit(response)
            logger.warning(f"Rate limited (429). Waiting {wait_seconds}s...")
            await asyncio.sleep(wait_seconds)
            continue

        # サーバーエラー (5xx) - 1回だけリトライ
        if 500 <= response.status_code < 600:
            if not server_error_retried:
                server_error_retried = True
                logger.warning(
                    f"Server error ({response.status_code}). Retrying once..."
                )
                await asyncio.sleep(DEFAULT_RETRY_DELAY_SEC)
                continue
            # 2回目の5xxエラーは即座にraise
            logger.error(f"Server error ({response.status_code}) after retry.")
            response.raise_for_status()

        # その他の4xxエラーは即座にraise
        response.raise_for_status()


# =============================================================================
# Types
# =============================================================================

class AuthInfo(TypedDict):
    """認証情報"""
    headers: dict[str, str]
    workspace_id: int


# =============================================================================
# Authentication Cache
# =============================================================================

_cached_auth: AuthInfo | None = None


async def get_auth_info() -> AuthInfo:
    """認証情報を取得（キャッシュ付き）

    Returns:
        認証ヘッダーとワークスペースID
    """
    global _cached_auth
    if _cached_auth is not None:
        return _cached_auth

    result = await get_credentials("toggl")
    credentials = result["credentials"]

    api_token = credentials.get("api_token")
    if not api_token:
        raise ValueError("Toggl credentials missing api_token")

    # Basic認証: api_token:api_token をBase64エンコード
    auth_string = f"{api_token}:api_token"
    encoded = base64.b64encode(auth_string.encode()).decode()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {encoded}",
    }

    # workspace_id を取得
    workspace_id = credentials.get("workspace_id")
    if not workspace_id:
        # credentials にない場合は /me から取得
        async with httpx.AsyncClient(headers=headers) as client:
            response = await client.get(f"{TRACK_API_BASE}/me")
            response.raise_for_status()
            me_data = response.json()
            workspace_id = me_data.get("default_workspace_id")

    if not workspace_id:
        raise ValueError("Failed to get workspace_id from Toggl")

    _cached_auth = AuthInfo(
        headers=headers,
        workspace_id=int(workspace_id),
    )
    return _cached_auth


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_auth
    _cached_auth = None


# =============================================================================
# Track API v9 - データ取得
# =============================================================================

async def fetch_time_entries(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """時間エントリーを取得（Track API v9）

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        時間エントリーのリスト（APIレスポンスそのまま）
    """
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/me/time_entries"
    params = {"start_date": start_date, "end_date": end_date}

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url, params=params)
        return response.json() or []


async def fetch_projects() -> list[dict[str, Any]]:
    """プロジェクト一覧を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/workspaces/{auth['workspace_id']}/projects"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json() or []


async def fetch_clients() -> list[dict[str, Any]]:
    """クライアント一覧を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/workspaces/{auth['workspace_id']}/clients"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json() or []


async def fetch_tags() -> list[dict[str, Any]]:
    """タグ一覧を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/workspaces/{auth['workspace_id']}/tags"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json() or []


async def fetch_me() -> dict[str, Any]:
    """現在のユーザー情報を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/me"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json()


async def fetch_workspaces() -> list[dict[str, Any]]:
    """ワークスペース一覧を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/workspaces"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json() or []


async def fetch_workspace_users() -> list[dict[str, Any]]:
    """ワークスペースユーザー一覧を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/workspaces/{auth['workspace_id']}/users"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json() or []


async def fetch_workspace_groups() -> list[dict[str, Any]]:
    """ワークスペースグループ一覧を取得"""
    auth = await get_auth_info()
    url = f"{TRACK_API_BASE}/workspaces/{auth['workspace_id']}/groups"

    async with httpx.AsyncClient(headers=auth["headers"], timeout=30.0) as client:
        response = await _request_with_retry(client, "GET", url)
        return response.json() or []


# =============================================================================
# Reports API v3 - 詳細レポート取得
# =============================================================================

async def fetch_detailed_report(
    start_date: str,
    end_date: str,
    first_row_number: int = 1,
    page_size: int = 1000,
) -> dict[str, Any]:
    """詳細レポートを取得（Reports API v3）

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）
        first_row_number: 開始行番号（ページネーション用）
        page_size: ページサイズ（最大1000、API制限を考慮し大きめに設定）

    Returns:
        レポートレスポンス（time_entries含む）
    """
    auth = await get_auth_info()
    url = f"{REPORTS_API_BASE}/workspace/{auth['workspace_id']}/search/time_entries"

    payload = {
        "start_date": start_date,
        "end_date": end_date,
        "first_row_number": first_row_number,
        "page_size": page_size,
    }

    async with httpx.AsyncClient(headers=auth["headers"], timeout=60.0) as client:
        response = await _request_with_retry(client, "POST", url, json=payload)
        return response.json()


async def fetch_all_detailed_report(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """詳細レポートを全件取得（ページネーション対応）

    Reports API v3 のページサイズは最大1000件。
    Free プランは30 requests/hour なので、1000件×30回 = 30,000件まで取得可能。

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        全タイムエントリーのリスト
    """
    all_entries = []
    first_row = 1
    page_size = 1000  # Reports API v3 の最大値

    while True:
        result = await fetch_detailed_report(
            start_date=start_date,
            end_date=end_date,
            first_row_number=first_row,
            page_size=page_size,
        )

        # Reports API v3 はリストを直接返す場合がある
        if isinstance(result, list):
            entries = result
        else:
            entries = result.get("time_entries") or result.get("data") or []

        if not entries:
            break

        all_entries.extend(entries)
        logger.info(f"Fetched {len(entries)} entries (total: {len(all_entries)})")

        # 次のページがあるかチェック
        if len(entries) < page_size:
            break

        first_row += page_size

    return all_entries
