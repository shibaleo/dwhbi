"""Google Calendar オーケストレーター

全データ同期の統合エントリーポイント。
マスタ → イベントの順で実行（マスタ内は並列）。
"""

import time
from typing import TypedDict

from pipelines.lib.logger import setup_logger
from pipelines.services.google_calendar.sync_events import sync_events
from pipelines.services.google_calendar.sync_masters import sync_masters

logger = setup_logger(__name__)


class SyncAllResult(TypedDict):
    """全同期結果"""
    success: bool
    events_count: int
    masters_counts: dict[str, int]
    elapsed_seconds: float


async def sync_all(days: int = 3) -> SyncAllResult:
    """Google Calendar の全データを同期

    マスタ → イベントの順で実行。
    マスタ内は並列で取得。

    Args:
        days: 同期する日数（events用）

    Returns:
        同期結果
    """
    start_time = time.perf_counter()
    logger.info(f"Starting Google Calendar full sync ({days} days)")

    errors = []
    events_count = 0
    masters_counts = {}

    try:
        # 1. マスタ同期（内部で並列実行）
        logger.info("Step 1: Syncing masters...")
        masters_result = await sync_masters()
        masters_counts = masters_result["counts"]

        if not masters_result["success"]:
            errors.append("masters: partial failure")
            logger.warning("Masters sync had partial failures, continuing with events...")

        # 2. イベント同期
        logger.info("Step 2: Syncing events...")
        events_result = await sync_events(days=days)
        events_count = events_result["count"]

        elapsed = round(time.perf_counter() - start_time, 2)

        # ログ出力
        masters_str = ", ".join(f"{k}={v}" for k, v in masters_counts.items())
        logger.info(
            f"Google Calendar full sync completed in {elapsed}s: "
            f"{masters_str}, events={events_count}"
        )

        if errors:
            logger.warning(f"Some syncs had issues: {errors}")

        return SyncAllResult(
            success=len(errors) == 0,
            events_count=events_count,
            masters_counts=masters_counts,
            elapsed_seconds=elapsed,
        )

    except Exception as e:
        elapsed = round(time.perf_counter() - start_time, 2)
        logger.error(f"Google Calendar full sync failed after {elapsed}s: {e}")
        raise
