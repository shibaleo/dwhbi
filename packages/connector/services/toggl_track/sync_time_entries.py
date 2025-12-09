"""Toggl Track タイムエントリー同期（Track API v9）

日次同期用。指定日数分のタイムエントリーを取得してraw層に保存。
実行中エントリー（duration < 0）も取得可能。
"""

import time
from datetime import date, timedelta
from typing import Any, TypedDict

from pipelines.db.raw_client import upsert_raw, RawRecord
from pipelines.lib.logger import setup_logger
from pipelines.services.toggl_track.api_client import fetch_time_entries

logger = setup_logger(__name__)

TABLE_NAME = "toggl_track__time_entries"
API_VERSION = "v9"


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    count: int
    elapsed_seconds: float


def _to_raw_record(entry: dict[str, Any]) -> RawRecord:
    """APIレスポンスをRawRecordに変換

    source_idはエントリーIDを使用。
    """
    return RawRecord(
        source_id=str(entry["id"]),
        data=entry,
    )


async def sync_time_entries(days: int = 3) -> SyncResult:
    """タイムエントリーを同期（Track API v9）

    Args:
        days: 同期する日数（今日から遡る）

    Returns:
        同期結果
    """
    start_time = time.perf_counter()
    logger.info(f"Starting Toggl time entries sync ({days} days)")

    # 日付範囲を計算（end_dateは翌日にして当日分を確実に取得）
    end_date = date.today() + timedelta(days=1)
    start_date = date.today() - timedelta(days=days - 1)

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    try:
        # API からデータ取得
        logger.info(f"Fetching time entries ({start_str} to {end_str})...")
        entries = await fetch_time_entries(start_str, end_str)
        logger.info(f"Fetched {len(entries)} time entries")

        # raw層に保存
        if entries:
            records = [_to_raw_record(e) for e in entries]
            result = await upsert_raw(TABLE_NAME, records, api_version=API_VERSION)
            count = result["total"]
        else:
            count = 0

        elapsed = round(time.perf_counter() - start_time, 2)
        logger.info(f"Toggl time entries sync completed: {count} entries in {elapsed}s")

        return SyncResult(
            success=True,
            count=count,
            elapsed_seconds=elapsed,
        )

    except Exception as e:
        elapsed = round(time.perf_counter() - start_time, 2)
        logger.error(f"Toggl time entries sync failed after {elapsed}s: {e}")
        raise
