"""Toggl Track オーケストレーター

全データ同期の統合エントリーポイント。
マスタ → エントリーの順で実行（マスタ内は並列）。
"""

import time
from typing import TypedDict

from pipelines.lib.logger import setup_logger
from pipelines.services.toggl_track.sync_time_entries import sync_time_entries
from pipelines.services.toggl_track.sync_masters import sync_masters

logger = setup_logger(__name__)


class SyncAllResult(TypedDict):
    """全同期結果"""
    success: bool
    time_entries_count: int
    masters_counts: dict[str, int]
    elapsed_seconds: float


async def sync_all(days: int = 3) -> SyncAllResult:
    """Toggl Track の全データを同期

    マスタ → エントリーの順で実行。
    マスタ内は並列で取得。

    Args:
        days: 同期する日数（time_entries用）

    Returns:
        同期結果
    """
    start_time = time.perf_counter()
    logger.info(f"Starting Toggl Track full sync ({days} days)")

    errors = []
    time_entries_count = 0
    masters_counts = {}

    try:
        # 1. マスタ同期（内部で並列実行）
        logger.info("Step 1: Syncing masters...")
        masters_result = await sync_masters()
        masters_counts = masters_result["counts"]

        if not masters_result["success"]:
            errors.append("masters: partial failure")
            logger.warning("Masters sync had partial failures, continuing with time entries...")

        # 2. エントリー同期
        logger.info("Step 2: Syncing time entries...")
        entries_result = await sync_time_entries(days=days)
        time_entries_count = entries_result["count"]

        elapsed = round(time.perf_counter() - start_time, 2)

        # ログ出力
        masters_str = ", ".join(f"{k}={v}" for k, v in masters_counts.items())
        logger.info(
            f"Toggl Track full sync completed in {elapsed}s: "
            f"{masters_str}, time_entries={time_entries_count}"
        )

        if errors:
            logger.warning(f"Some syncs had issues: {errors}")

        return SyncAllResult(
            success=len(errors) == 0,
            time_entries_count=time_entries_count,
            masters_counts=masters_counts,
            elapsed_seconds=elapsed,
        )

    except Exception as e:
        elapsed = round(time.perf_counter() - start_time, 2)
        logger.error(f"Toggl Track full sync failed after {elapsed}s: {e}")
        raise
