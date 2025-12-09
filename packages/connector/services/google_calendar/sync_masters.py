"""Google Calendar マスタデータ同期

colors, calendar_list, calendars を同期。
"""

import asyncio
import time
from typing import Any, TypedDict

from db.raw_client import upsert_raw, RawRecord
from lib.logger import setup_logger
from services.google_calendar.api_client import (
    fetch_colors,
    fetch_calendar_list,
    fetch_calendar,
    get_auth_info,
)

logger = setup_logger(__name__)

API_VERSION = "v3"


class MasterSyncResult(TypedDict):
    """マスタ同期結果"""
    success: bool
    counts: dict[str, int]
    elapsed_seconds: float


async def _sync_colors() -> int:
    """カラーパレットを同期

    Colors APIは event と calendar の2種類のカラーを返す。
    それぞれ別レコードとして保存。
    """
    data = await fetch_colors()
    if not data:
        return 0

    records = []

    # イベントカラー
    if data.get("event"):
        records.append(RawRecord(
            source_id="event",
            data={"kind": "event", "colors": data["event"]},
        ))

    # カレンダーカラー
    if data.get("calendar"):
        records.append(RawRecord(
            source_id="calendar",
            data={"kind": "calendar", "colors": data["calendar"]},
        ))

    if not records:
        return 0

    result = await upsert_raw("google_calendar__colors", records, api_version=API_VERSION)
    return result["total"]


async def _sync_calendar_list() -> int:
    """カレンダーリストを同期"""
    data = await fetch_calendar_list()
    if not data:
        return 0

    records = [
        RawRecord(source_id=item["id"], data=item)
        for item in data
    ]

    result = await upsert_raw("google_calendar__calendar_list", records, api_version=API_VERSION)
    return result["total"]


async def _sync_calendars() -> int:
    """カレンダーメタデータを同期

    設定されているcalendar_idのメタデータを取得。
    """
    auth = await get_auth_info()
    calendar_id = auth["calendar_id"]

    data = await fetch_calendar(calendar_id)
    if not data:
        return 0

    record = RawRecord(source_id=data["id"], data=data)
    result = await upsert_raw("google_calendar__calendars", [record], api_version=API_VERSION)
    return result["total"]


async def sync_masters() -> MasterSyncResult:
    """全マスタデータを並列同期

    Returns:
        同期結果（各マスタの件数）
    """
    start_time = time.perf_counter()
    logger.info("Starting Google Calendar masters sync")

    try:
        # 並列実行前にキャッシュを温める（リフレッシュの重複を防ぐ）
        await get_auth_info()

        # 全マスタを並列取得・保存
        results = await asyncio.gather(
            _sync_colors(),
            _sync_calendar_list(),
            _sync_calendars(),
            return_exceptions=True,
        )

        # 結果を整理
        master_names = ["colors", "calendar_list", "calendars"]
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
        logger.info(f"Google Calendar masters sync completed in {elapsed}s: {counts_str}")

        if errors:
            logger.warning(f"Some masters failed: {errors}")

        return MasterSyncResult(
            success=len(errors) == 0,
            counts=counts,
            elapsed_seconds=elapsed,
        )

    except Exception as e:
        elapsed = round(time.perf_counter() - start_time, 2)
        logger.error(f"Google Calendar masters sync failed after {elapsed}s: {e}")
        raise
