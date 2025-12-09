"""Google Calendar イベント同期

日次同期用。指定日数分のイベントを取得してraw層に保存。
2500件を超える場合はページネーションで取得。
終了日から開始日に向かって遡りながら取得。
"""

import time
from datetime import date, timedelta
from typing import Any, TypedDict

from db.raw_client import upsert_raw_batch, RawRecord
from lib.logger import setup_logger
from services.google_calendar.api_client import fetch_events

logger = setup_logger(__name__)

TABLE_NAME = "google_calendar__events"
API_VERSION = "v3"

# Google Calendar API の制限
# - maxResults: 最大2500件/ページ（デフォルト250）
# - ページネーションはAPI側で自動処理
MAX_EVENTS_PER_CHUNK = 2500


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    count: int
    elapsed_seconds: float


def _to_raw_record(event: dict[str, Any]) -> RawRecord:
    """APIレスポンスをRawRecordに変換

    source_idは {calendarId}:{eventId} 形式。
    """
    calendar_id = event.get("_calendar_id", "primary")
    event_id = event["id"]
    source_id = f"{calendar_id}:{event_id}"

    return RawRecord(
        source_id=source_id,
        data=event,
    )


async def sync_events(
    days: int = 3,
    start_date: str | None = None,
    end_date: str | None = None,
) -> SyncResult:
    """イベントを同期

    終了日から開始日に向かって遡りながら取得。
    2500件を超える場合はページネーションで自動処理。

    Args:
        days: 同期する日数（今日から遡る、start_date/end_date未指定時）
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）

    Returns:
        同期結果
    """
    start_time = time.perf_counter()

    # 日付範囲を決定（end_dateは翌日にして当日分を確実に取得）
    if start_date and end_date:
        start_d = date.fromisoformat(start_date)
        end_d = date.fromisoformat(end_date)
    else:
        end_d = date.today() + timedelta(days=1)
        start_d = date.today() - timedelta(days=days - 1)

    logger.info(f"Starting Google Calendar events sync ({start_d} to {end_d})")

    total_count = 0
    current_end = end_d

    # 終了日から開始日に向かって遡りながら取得
    chunk_num = 0
    while current_end > start_d:
        chunk_num += 1
        chunk_start_str = start_d.isoformat()
        chunk_end_str = current_end.isoformat()

        logger.info(f"Fetching chunk {chunk_num}: {chunk_start_str} to {chunk_end_str}")

        try:
            # API からデータ取得（ページネーション対応済み）
            events = await fetch_events(chunk_start_str, chunk_end_str)
            logger.info(f"Fetched {len(events)} events")

            if not events:
                break

            # DB保存
            records = [_to_raw_record(e) for e in events]
            result = await upsert_raw_batch(TABLE_NAME, records, api_version=API_VERSION)
            total_count += result["total"]
            logger.info(f"Saved {result['total']} events to DB (total: {total_count})")

            # 2500件未満なら全件取得完了
            if len(events) < MAX_EVENTS_PER_CHUNK:
                break

            # 次のチャンク: 最も古いイベントの日付より前から取得
            oldest_event = min(events, key=lambda e: e.get("start", {}).get("dateTime") or e.get("start", {}).get("date", ""))
            oldest_start = oldest_event.get("start", {})
            oldest_date_str = oldest_start.get("dateTime") or oldest_start.get("date")
            if oldest_date_str:
                # dateTimeの場合は日付部分だけ取得
                oldest_date = date.fromisoformat(oldest_date_str[:10])
                current_end = oldest_date
            else:
                break

        except Exception as e:
            elapsed = round(time.perf_counter() - start_time, 2)
            # レートリミットの場合は取得済み分を返して終了
            if "429" in str(e) or "rateLimitExceeded" in str(e):
                logger.warning(
                    f"Google Calendar API rate limit. Saved {total_count} events before limit."
                )
                return SyncResult(
                    success=total_count > 0,
                    count=total_count,
                    elapsed_seconds=elapsed,
                )
            logger.error(f"Google Calendar events sync failed after {elapsed}s: {e}")
            raise

    elapsed = round(time.perf_counter() - start_time, 2)
    logger.info(f"Google Calendar events sync completed: {total_count} events in {elapsed}s")

    return SyncResult(
        success=True,
        count=total_count,
        elapsed_seconds=elapsed,
    )
