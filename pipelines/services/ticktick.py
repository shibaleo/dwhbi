"""TickTick API 同期

TickTick Open API を使用してプロジェクト、タスクを取得し、
raw.ticktick_* テーブルに保存する。

OAuth2認証（自動トークンリフレッシュ対応）
"""

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials import get_credentials, update_credentials
from pipelines.lib.db import get_supabase_client
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Constants
# =============================================================================

BASE_URL = "https://api.ticktick.com/open/v1"
TOKEN_URL = "https://ticktick.com/oauth/token"
DEFAULT_THRESHOLD_MINUTES = 60


# =============================================================================
# Types
# =============================================================================


class OAuth2Credentials(TypedDict):
    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    token_type: str
    scope: str


class TickTickProject(TypedDict):
    """TickTick API Project レスポンス"""
    id: str
    name: str
    color: str | None
    sortOrder: int | None
    sortType: str | None
    viewMode: str | None
    kind: str | None
    isOwner: bool | None
    closed: bool | None
    groupId: str | None


class TickTickTask(TypedDict):
    """TickTick API Task レスポンス"""
    id: str
    projectId: str | None
    title: str
    content: str | None
    desc: str | None
    priority: int
    status: int
    sortOrder: int | None
    startDate: str | None
    dueDate: str | None
    completedTime: str | None
    timeZone: str | None
    isAllDay: bool | None
    reminder: str | None
    reminders: list[dict] | None
    repeatFlag: str | None
    tags: list[str] | None
    items: list[dict] | None
    progress: int | None
    kind: str | None
    createdTime: str | None
    modifiedTime: str | None


# DB Types
class DbProject(TypedDict):
    """raw.ticktick_projects テーブルレコード"""
    id: str
    name: str
    color: str | None
    sort_order: int | None
    sort_type: str | None
    view_mode: str | None
    kind: str | None
    is_owner: bool | None
    closed: bool | None
    group_id: str | None


class DbTask(TypedDict):
    """raw.ticktick_tasks テーブルレコード"""
    id: str
    project_id: str | None
    title: str
    content: str | None
    description: str | None
    priority: int
    status: int
    sort_order: int | None
    start_date: str | None
    due_date: str | None
    completed_time: str | None
    timezone: str | None
    is_all_day: bool | None
    reminder: str | None
    reminders: list[dict] | None
    repeat_flag: str | None
    tags: list[str] | None
    items: list[dict] | None
    progress: int | None
    kind: str | None
    created_time: str | None
    modified_time: str | None


class SyncStats(TypedDict):
    """同期統計"""
    projects: int
    tasks: int
    completed_tasks: int


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    stats: SyncStats


# =============================================================================
# Authentication
# =============================================================================

_auth_cache: tuple[str, datetime] | None = None


async def refresh_access_token(credentials: OAuth2Credentials) -> dict:
    """アクセストークンをリフレッシュ"""
    logger.info("Refreshing TickTick access token...")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            TOKEN_URL,
            data={
                "client_id": credentials["client_id"],
                "client_secret": credentials["client_secret"],
                "refresh_token": credentials["refresh_token"],
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if response.status_code != 200:
            logger.error(f"Token refresh failed: {response.status_code}")
            logger.error(f"Response: {response.text}")
            raise RuntimeError(f"Token refresh failed: {response.status_code}")

        return response.json()


async def get_access_token(force_refresh: bool = False) -> str:
    """アクセストークンを取得（必要に応じてリフレッシュ）"""
    global _auth_cache

    if not force_refresh and _auth_cache is not None:
        token, expires_at = _auth_cache
        minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        if minutes_until_expiry > DEFAULT_THRESHOLD_MINUTES:
            logger.info(f"Token valid ({minutes_until_expiry:.0f} min remaining)")
            return token

    result = await get_credentials("ticktick")
    if not result:
        raise ValueError("TickTick credentials not found")

    credentials: OAuth2Credentials = result["credentials"]
    expires_at = result.get("expires_at")

    if not credentials.get("client_id") or not credentials.get("client_secret"):
        raise ValueError("Missing client_id or client_secret")
    if not credentials.get("access_token"):
        raise ValueError("Missing access_token")

    needs_refresh = force_refresh
    if not needs_refresh and expires_at:
        minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        needs_refresh = minutes_until_expiry <= DEFAULT_THRESHOLD_MINUTES

    if not needs_refresh and expires_at:
        _auth_cache = (credentials["access_token"], expires_at)
        return credentials["access_token"]

    # トークンをリフレッシュ（refresh_tokenが必要）
    if not credentials.get("refresh_token"):
        raise ValueError("Token expired and no refresh_token available. Please re-authenticate.")
    token_data = await refresh_access_token(credentials)

    # 新しい認証情報を保存
    new_credentials = {
        **credentials,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", credentials["refresh_token"]),
    }

    new_expires_at = None
    if "expires_in" in token_data:
        new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])

    await update_credentials("ticktick", new_credentials, new_expires_at)
    logger.info("Token refreshed and saved")

    if new_expires_at:
        _auth_cache = (new_credentials["access_token"], new_expires_at)

    return new_credentials["access_token"]


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _auth_cache
    _auth_cache = None


# =============================================================================
# API Client
# =============================================================================


async def fetch_projects(client: httpx.AsyncClient, token: str) -> list[TickTickProject]:
    """プロジェクト一覧を取得"""
    url = f"{BASE_URL}/project"
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get(url, headers=headers)
    response.raise_for_status()
    return response.json() or []


async def fetch_project_tasks(
    client: httpx.AsyncClient,
    token: str,
    project_id: str
) -> list[TickTickTask]:
    """プロジェクト内のタスクを取得"""
    url = f"{BASE_URL}/project/{project_id}/data"
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get(url, headers=headers)

    if response.status_code == 404:
        # プロジェクトが空または存在しない
        return []

    response.raise_for_status()
    data = response.json()

    # dataにはtasksが含まれる
    return data.get("tasks", [])


async def fetch_completed_tasks(
    client: httpx.AsyncClient,
    token: str,
    project_id: str,
    start_date: datetime,
    end_date: datetime
) -> list[TickTickTask]:
    """完了済みタスクを取得"""
    url = f"{BASE_URL}/project/{project_id}/completed"
    headers = {"Authorization": f"Bearer {token}"}

    # 日付フォーマット: YYYY-MM-DDTHH:mm:ssZ
    params = {
        "from": start_date.strftime("%Y-%m-%dT%H:%M:%S+0000"),
        "to": end_date.strftime("%Y-%m-%dT%H:%M:%S+0000"),
    }

    response = await client.get(url, headers=headers, params=params)

    if response.status_code == 404:
        return []

    response.raise_for_status()
    return response.json() or []


# =============================================================================
# DB Transformation
# =============================================================================


def to_db_project(project: TickTickProject) -> DbProject:
    """API Project -> DB Project"""
    return DbProject(
        id=project["id"],
        name=project["name"],
        color=project.get("color"),
        sort_order=project.get("sortOrder"),
        sort_type=project.get("sortType"),
        view_mode=project.get("viewMode"),
        kind=project.get("kind"),
        is_owner=project.get("isOwner"),
        closed=project.get("closed", False),
        group_id=project.get("groupId"),
    )


def to_db_task(task: TickTickTask) -> DbTask:
    """API Task -> DB Task"""
    return DbTask(
        id=task["id"],
        project_id=task.get("projectId"),
        title=task["title"],
        content=task.get("content"),
        description=task.get("desc"),
        priority=task.get("priority", 0),
        status=task.get("status", 0),
        sort_order=task.get("sortOrder"),
        start_date=task.get("startDate"),
        due_date=task.get("dueDate"),
        completed_time=task.get("completedTime"),
        timezone=task.get("timeZone"),
        is_all_day=task.get("isAllDay"),
        reminder=task.get("reminder"),
        reminders=task.get("reminders"),
        repeat_flag=task.get("repeatFlag"),
        tags=task.get("tags"),
        items=task.get("items"),
        progress=task.get("progress"),
        kind=task.get("kind"),
        created_time=task.get("createdTime"),
        modified_time=task.get("modifiedTime"),
    )


# =============================================================================
# DB Write
# =============================================================================


async def upsert_projects(projects: list[TickTickProject]) -> int:
    """プロジェクトを upsert"""
    if not projects:
        return 0

    records = [to_db_project(p) for p in projects]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("ticktick_projects")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} projects to raw.ticktick_projects")
    return saved_count


async def upsert_tasks(tasks: list[TickTickTask]) -> int:
    """タスクを upsert"""
    if not tasks:
        return 0

    records = [to_db_task(t) for t in tasks]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("ticktick_tasks")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} tasks to raw.ticktick_tasks")
    return saved_count


async def upsert_completed_tasks(tasks: list[TickTickTask]) -> int:
    """完了済みタスクを upsert"""
    if not tasks:
        return 0

    records = [to_db_task(t) for t in tasks]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("ticktick_completed_tasks")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} completed tasks to raw.ticktick_completed_tasks")
    return saved_count


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_ticktick(days: int = 7) -> SyncResult:
    """TickTick データを同期

    Args:
        days: 完了済みタスクを取得する日数（デフォルト: 7日）
    """
    total_start = time.perf_counter()
    logger.info(f"Starting TickTick sync (completed tasks: last {days} days)")

    # 認証
    token = await get_access_token()

    # 完了タスク取得期間
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)

    all_projects: list[TickTickProject] = []
    all_tasks: list[TickTickTask] = []
    all_completed: list[TickTickTask] = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. プロジェクト一覧を取得
        logger.info("Fetching projects...")
        all_projects = await fetch_projects(client, token)
        logger.info(f"Fetched {len(all_projects)} projects")

        # 2. 各プロジェクトのタスクを取得
        logger.info("Fetching tasks...")
        for project in all_projects:
            project_id = project["id"]
            project_name = project["name"]

            # 未完了タスク
            tasks = await fetch_project_tasks(client, token, project_id)
            all_tasks.extend(tasks)

            # 完了済みタスク
            completed = await fetch_completed_tasks(
                client, token, project_id, start_date, end_date
            )
            all_completed.extend(completed)

            logger.info(
                f"Project '{project_name}': {len(tasks)} tasks, {len(completed)} completed"
            )

            # レート制限対策
            await asyncio.sleep(0.1)

    logger.info(
        f"Fetched {len(all_projects)} projects, "
        f"{len(all_tasks)} tasks, "
        f"{len(all_completed)} completed tasks"
    )

    # 3. DB に保存
    db_start = time.perf_counter()
    logger.info("Saving to database...")

    projects_count = await upsert_projects(all_projects)
    tasks_count = await upsert_tasks(all_tasks)
    completed_count = await upsert_completed_tasks(all_completed)

    db_elapsed = round(time.perf_counter() - db_start, 2)

    stats = SyncStats(
        projects=projects_count,
        tasks=tasks_count,
        completed_tasks=completed_count,
    )

    total_elapsed = round(time.perf_counter() - total_start, 2)

    logger.info(
        f"TickTick sync completed in {total_elapsed}s (db: {db_elapsed}s)"
    )

    return SyncResult(
        success=True,
        stats=stats,
    )


# =============================================================================
# CLI Entry Point
# =============================================================================

if __name__ == "__main__":
    asyncio.run(sync_ticktick())
