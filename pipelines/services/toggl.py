"""Toggl Track API 同期

Toggl API v9 を使用して時間エントリーを取得し、raw.toggl_entries に保存する。
"""

import base64
import time
from datetime import date, timedelta
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials_vault import get_credentials
from pipelines.lib.db import get_supabase_client
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Types
# =============================================================================


class TogglClient(TypedDict):
    """Toggl API v9 Client レスポンス"""
    id: int
    wid: int  # workspace_id
    name: str
    archived: bool
    at: str  # ISO8601


class TogglProject(TypedDict):
    """Toggl API v9 Project レスポンス"""
    id: int
    workspace_id: int
    client_id: int | None
    name: str
    color: str | None
    is_private: bool
    active: bool
    billable: bool | None
    created_at: str
    at: str  # ISO8601
    server_deleted_at: str | None


class TogglTag(TypedDict):
    """Toggl API v9 Tag レスポンス"""
    id: int
    workspace_id: int
    name: str
    at: str  # ISO8601


class TogglTimeEntry(TypedDict):
    """Toggl API v9 Time Entry レスポンス"""
    id: int
    workspace_id: int
    project_id: int | None
    task_id: int | None
    user_id: int
    description: str | None
    start: str  # ISO8601
    stop: str | None  # ISO8601
    duration: int  # 秒（負の値は実行中）
    billable: bool
    tags: list[str]
    at: str  # ISO8601


class DbClient(TypedDict):
    """raw.toggl_clients テーブルレコード"""
    id: int
    workspace_id: int
    name: str
    is_archived: bool
    created_at: str


class DbProject(TypedDict):
    """raw.toggl_projects テーブルレコード"""
    id: int
    workspace_id: int
    client_id: int | None
    name: str
    color: str | None
    is_private: bool
    is_active: bool
    is_billable: bool
    created_at: str
    archived_at: str | None


class DbTag(TypedDict):
    """raw.toggl_tags テーブルレコード"""
    id: int
    workspace_id: int
    name: str
    created_at: str


class DbEntry(TypedDict):
    """raw.toggl_entries テーブルレコード"""
    id: int
    workspace_id: int
    project_id: int | None
    task_id: int | None
    user_id: int
    description: str | None
    start: str
    end: str
    duration_ms: int
    is_billable: bool
    billable_amount: float | None
    currency: str | None
    tags: list[str]
    updated_at: str


class SyncStats(TypedDict):
    """同期統計"""
    clients: int
    projects: int
    tags: int
    entries: int


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    stats: SyncStats


# =============================================================================
# Configuration
# =============================================================================

BASE_URL = "https://api.track.toggl.com/api/v9"
MAX_RETRIES = 3
RETRY_DELAY_MS = 2000


# =============================================================================
# Authentication
# =============================================================================

# キャッシュ用変数
_cached_headers: dict[str, str] | None = None
_cached_workspace_id: int | None = None


async def get_auth_headers() -> dict[str, str]:
    """Toggl API 認証ヘッダーを取得（キャッシュ付き）

    Returns:
        Basic認証ヘッダー

    Raises:
        ValueError: 認証情報が不正
    """
    global _cached_headers
    if _cached_headers is not None:
        return _cached_headers

    result = await get_credentials("toggl")
    credentials = result["credentials"]

    api_token = credentials.get("api_token")
    if not api_token:
        raise ValueError("Toggl credentials missing api_token")

    # Basic認証: api_token:api_token をBase64エンコード
    auth_string = f"{api_token}:api_token"
    encoded = base64.b64encode(auth_string.encode()).decode()

    _cached_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {encoded}",
    }
    return _cached_headers


async def get_workspace_id() -> int:
    """ワークスペースIDを取得（キャッシュ付き）

    Returns:
        ワークスペースID

    Raises:
        ValueError: workspace_idが未設定
    """
    global _cached_workspace_id
    if _cached_workspace_id is not None:
        return _cached_workspace_id

    result = await get_credentials("toggl")
    credentials = result["credentials"]

    workspace_id = credentials.get("workspace_id")
    if not workspace_id:
        raise ValueError("Toggl credentials missing workspace_id")

    _cached_workspace_id = int(workspace_id)
    return _cached_workspace_id


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_headers, _cached_workspace_id
    _cached_headers = None
    _cached_workspace_id = None


# =============================================================================
# API Client
# =============================================================================


class FetchResult(TypedDict):
    """データ取得結果"""
    clients: list[TogglClient]
    projects: list[TogglProject]
    tags: list[TogglTag]
    entries: list[TogglTimeEntry]
    http_requests: int
    elapsed_seconds: float


async def fetch_all_metadata_and_entries(
    start_date: str,
    end_date: str,
) -> FetchResult:
    """メタデータとエントリーを並列取得（HTTPクライアント共有）

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        FetchResult（データ + リクエスト数 + 実行時間）
    """
    import asyncio

    start_time = time.perf_counter()

    headers = await get_auth_headers()
    workspace_id = await get_workspace_id()

    async with httpx.AsyncClient(headers=headers, timeout=30.0) as client:
        # 並列で全APIを呼び出し
        clients_task = client.get(f"{BASE_URL}/workspaces/{workspace_id}/clients")
        projects_task = client.get(f"{BASE_URL}/workspaces/{workspace_id}/projects")
        tags_task = client.get(f"{BASE_URL}/workspaces/{workspace_id}/tags")
        entries_task = client.get(
            f"{BASE_URL}/me/time_entries",
            params={"start_date": start_date, "end_date": end_date}
        )

        responses = await asyncio.gather(
            clients_task, projects_task, tags_task, entries_task
        )

        # エラーチェック
        for resp in responses:
            resp.raise_for_status()

        clients_data = responses[0].json() or []
        projects_data = responses[1].json() or []
        tags_data = responses[2].json() or []
        entries_data = responses[3].json() or []

        elapsed = time.perf_counter() - start_time

        return FetchResult(
            clients=clients_data,
            projects=projects_data,
            tags=tags_data,
            entries=entries_data,
            http_requests=4,
            elapsed_seconds=round(elapsed, 2),
        )


async def fetch_clients() -> list[TogglClient]:
    """クライアント一覧を取得"""
    headers = await get_auth_headers()
    workspace_id = await get_workspace_id()
    url = f"{BASE_URL}/workspaces/{workspace_id}/clients"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json() or []


async def fetch_projects() -> list[TogglProject]:
    """プロジェクト一覧を取得"""
    headers = await get_auth_headers()
    workspace_id = await get_workspace_id()
    url = f"{BASE_URL}/workspaces/{workspace_id}/projects"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json() or []


async def fetch_tags() -> list[TogglTag]:
    """タグ一覧を取得"""
    headers = await get_auth_headers()
    workspace_id = await get_workspace_id()
    url = f"{BASE_URL}/workspaces/{workspace_id}/tags"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=30.0)
        response.raise_for_status()
        return response.json() or []


async def fetch_entries_by_range(
    start_date: str,
    end_date: str,
    max_retries: int = MAX_RETRIES
) -> list[TogglTimeEntry]:
    """指定期間の時間エントリーを取得

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）
        max_retries: 最大リトライ回数（500系エラーのみ）

    Returns:
        時間エントリーのリスト

    Raises:
        httpx.HTTPStatusError: APIエラー（4xx系は即座にraise）
    """
    headers = await get_auth_headers()
    url = f"{BASE_URL}/me/time_entries"
    params = {"start_date": start_date, "end_date": end_date}

    async with httpx.AsyncClient() as client:
        for attempt in range(1, max_retries + 1):
            try:
                response = await client.get(url, headers=headers, params=params, timeout=30.0)
                response.raise_for_status()
                return response.json()

            except httpx.HTTPStatusError as e:
                # 500系エラーはリトライ
                if 500 <= e.response.status_code < 600:
                    if attempt < max_retries:
                        logger.warning(
                            f"Toggl API returned {e.response.status_code}, "
                            f"retrying ({attempt}/{max_retries})..."
                        )
                        await httpx.AsyncClient().aclose()  # 念のためクライアントをクローズ
                        continue
                # 4xx系またはリトライ上限に達した場合はraise
                raise


# =============================================================================
# DB Transformation
# =============================================================================


def to_db_client(client: TogglClient) -> DbClient:
    """API Client → DB Client"""
    return DbClient(
        id=client["id"],
        workspace_id=client["wid"],
        name=client["name"],
        is_archived=client.get("archived", False),
        created_at=client["at"],
    )


def to_db_project(project: TogglProject) -> DbProject:
    """API Project → DB Project"""
    return DbProject(
        id=project["id"],
        workspace_id=project["workspace_id"],
        client_id=project.get("client_id"),
        name=project["name"],
        color=project.get("color"),
        is_private=project.get("is_private", False),
        is_active=project.get("active", True),
        is_billable=project.get("billable", False) or False,
        created_at=project["created_at"],
        archived_at=project.get("server_deleted_at"),
    )


def to_db_tag(tag: TogglTag) -> DbTag:
    """API Tag → DB Tag"""
    return DbTag(
        id=tag["id"],
        workspace_id=tag["workspace_id"],
        name=tag["name"],
        created_at=tag["at"],
    )


def to_db_entry(entry: TogglTimeEntry) -> DbEntry:
    """API型 → DB型への変換

    実行中エントリー（duration < 0）も保存する。
    実行中の場合: end = None, duration_ms = None
    stagingビューで動的にCURRENT_TIMESTAMPを補完する。

    Args:
        entry: Toggl API レスポンス

    Returns:
        DBレコード形式
    """
    is_running = entry["duration"] < 0

    return DbEntry(
        id=entry["id"],
        workspace_id=entry["workspace_id"],
        project_id=entry.get("project_id"),
        task_id=entry.get("task_id"),
        user_id=entry["user_id"],
        description=entry.get("description"),
        start=entry["start"],
        end=None if is_running else (entry.get("stop") or entry["start"]),
        duration_ms=None if is_running else entry["duration"] * 1000,
        is_billable=entry.get("billable", False),
        billable_amount=None,  # Reports APIのみで取得可能
        currency=None,
        tags=entry.get("tags", []),
        updated_at=entry["at"],
    )


# =============================================================================
# DB Write
# =============================================================================


async def upsert_clients(clients: list[TogglClient]) -> int:
    """クライアントを raw.toggl_clients に upsert"""
    if not clients:
        return 0

    records = [to_db_client(c) for c in clients]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("toggl_clients")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} clients to raw.toggl_clients")
    return saved_count


async def upsert_projects(projects: list[TogglProject]) -> int:
    """プロジェクトを raw.toggl_projects に upsert"""
    if not projects:
        return 0

    records = [to_db_project(p) for p in projects]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("toggl_projects")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} projects to raw.toggl_projects")
    return saved_count


async def upsert_tags(tags: list[TogglTag]) -> int:
    """タグを raw.toggl_tags に upsert"""
    if not tags:
        return 0

    records = [to_db_tag(t) for t in tags]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("toggl_tags")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} tags to raw.toggl_tags")
    return saved_count


async def upsert_entries(entries: list[TogglTimeEntry]) -> int:
    """エントリーを raw.toggl_entries に upsert

    実行中エントリー（duration < 0）も保存する。
    実行中の場合はend=null, duration_ms=nullで保存される。

    Args:
        entries: API レスポンスのエントリーリスト

    Returns:
        保存件数
    """
    if not entries:
        return 0

    records = [to_db_entry(e) for e in entries]

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("toggl_entries")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} Toggl entries to raw.toggl_entries")

    return saved_count


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_toggl(days: int = 3) -> SyncResult:
    """Toggl データを同期

    Args:
        days: 同期する日数（今日から遡る）

    Returns:
        同期結果
    """
    total_start = time.perf_counter()
    logger.info(f"Starting Toggl sync ({days} days)")

    # 日付範囲を計算
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    # 1. API からデータ取得（全て並列、HTTPクライアント共有）
    logger.info(f"Fetching all data ({start_str} to {end_str})...")
    fetch_result = await fetch_all_metadata_and_entries(start_str, end_str)
    logger.info(
        f"Fetched {len(fetch_result['clients'])} clients, "
        f"{len(fetch_result['projects'])} projects, "
        f"{len(fetch_result['tags'])} tags, "
        f"{len(fetch_result['entries'])} entries "
        f"({fetch_result['http_requests']} HTTP requests in {fetch_result['elapsed_seconds']}s)"
    )

    # 2. DB に保存（メタデータを先に保存）
    db_start = time.perf_counter()
    logger.info("Saving to database...")
    clients_count = await upsert_clients(fetch_result['clients'])
    projects_count = await upsert_projects(fetch_result['projects'])
    tags_count = await upsert_tags(fetch_result['tags'])
    entries_count = await upsert_entries(fetch_result['entries'])
    db_elapsed = round(time.perf_counter() - db_start, 2)

    stats = SyncStats(
        clients=clients_count,
        projects=projects_count,
        tags=tags_count,
        entries=entries_count,
    )

    total_elapsed = round(time.perf_counter() - total_start, 2)

    logger.info(
        f"Toggl sync completed in {total_elapsed}s "
        f"(fetch: {fetch_result['elapsed_seconds']}s, db: {db_elapsed}s): "
        f"{stats['clients']} clients, "
        f"{stats['projects']} projects, "
        f"{stats['tags']} tags, "
        f"{stats['entries']} entries"
    )

    return SyncResult(
        success=True,
        stats=stats,
    )
