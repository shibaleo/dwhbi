"""Toggl Track マスタデータ同期

projects, clients, tags, me, workspaces, users, groups を同期。
全マスタを並列で取得・保存。
"""

import asyncio
import time
from typing import Any, TypedDict

from db.raw_client import upsert_raw, RawRecord
from lib.logger import setup_logger
from services.toggl_track.api_client import (
    fetch_projects,
    fetch_clients,
    fetch_tags,
    fetch_me,
    fetch_workspaces,
    fetch_workspace_users,
    fetch_workspace_groups,
)

logger = setup_logger(__name__)

API_VERSION = "v9"


class MasterSyncResult(TypedDict):
    """マスタ同期結果"""
    success: bool
    counts: dict[str, int]
    elapsed_seconds: float


def _to_raw_records(items: list[dict[str, Any]], id_field: str = "id") -> list[RawRecord]:
    """APIレスポンスをRawRecordリストに変換"""
    return [
        RawRecord(source_id=str(item[id_field]), data=item)
        for item in items
    ]


async def _sync_projects() -> int:
    """プロジェクトを同期"""
    data = await fetch_projects()
    if not data:
        return 0
    records = _to_raw_records(data)
    result = await upsert_raw("toggl_track__projects", records, api_version=API_VERSION)
    return result["total"]


async def _sync_clients() -> int:
    """クライアントを同期"""
    data = await fetch_clients()
    if not data:
        return 0
    records = _to_raw_records(data)
    result = await upsert_raw("toggl_track__clients", records, api_version=API_VERSION)
    return result["total"]


async def _sync_tags() -> int:
    """タグを同期"""
    data = await fetch_tags()
    if not data:
        return 0
    records = _to_raw_records(data)
    result = await upsert_raw("toggl_track__tags", records, api_version=API_VERSION)
    return result["total"]


async def _sync_me() -> int:
    """現在のユーザー情報を同期"""
    data = await fetch_me()
    if not data:
        return 0
    record = RawRecord(source_id=str(data["id"]), data=data)
    result = await upsert_raw("toggl_track__me", [record], api_version=API_VERSION)
    return result["total"]


async def _sync_workspaces() -> int:
    """ワークスペースを同期"""
    data = await fetch_workspaces()
    if not data:
        return 0
    records = _to_raw_records(data)
    result = await upsert_raw("toggl_track__workspaces", records, api_version=API_VERSION)
    return result["total"]


async def _sync_users() -> int:
    """ワークスペースユーザーを同期"""
    data = await fetch_workspace_users()
    if not data:
        return 0
    records = _to_raw_records(data)
    result = await upsert_raw("toggl_track__users", records, api_version=API_VERSION)
    return result["total"]


async def _sync_groups() -> int:
    """ワークスペースグループを同期"""
    data = await fetch_workspace_groups()
    if not data:
        return 0
    records = _to_raw_records(data)
    result = await upsert_raw("toggl_track__groups", records, api_version=API_VERSION)
    return result["total"]


async def sync_masters() -> MasterSyncResult:
    """全マスタデータを並列同期

    Returns:
        同期結果（各マスタの件数）
    """
    start_time = time.perf_counter()
    logger.info("Starting Toggl masters sync")

    try:
        # 全マスタを並列取得・保存
        results = await asyncio.gather(
            _sync_projects(),
            _sync_clients(),
            _sync_tags(),
            _sync_me(),
            _sync_workspaces(),
            _sync_users(),
            _sync_groups(),
            return_exceptions=True,
        )

        # 結果を整理
        master_names = ["projects", "clients", "tags", "me", "workspaces", "users", "groups"]
        counts = {}
        errors = []

        for name, result in zip(master_names, results):
            if isinstance(result, Exception):
                logger.error(f"Failed to sync {name}: {result}")
                errors.append(f"{name}: {result}")
                counts[name] = 0
            else:
                counts[name] = result

        elapsed = round(time.perf_counter() - start_time, 2)

        # ログ出力
        counts_str = ", ".join(f"{k}={v}" for k, v in counts.items())
        logger.info(f"Toggl masters sync completed in {elapsed}s: {counts_str}")

        if errors:
            logger.warning(f"Some masters failed: {errors}")

        return MasterSyncResult(
            success=len(errors) == 0,
            counts=counts,
            elapsed_seconds=elapsed,
        )

    except Exception as e:
        elapsed = round(time.perf_counter() - start_time, 2)
        logger.error(f"Toggl masters sync failed after {elapsed}s: {e}")
        raise
