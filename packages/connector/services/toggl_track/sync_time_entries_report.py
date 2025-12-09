"""Toggl Track タイムエントリー同期（Reports API v3）

全件取得用。Reports APIを使用して指定期間の全タイムエントリーを取得。
billable_amount等の追加情報も取得可能。
初期ロードやデータ修復時に使用。
終了日から開始日に向かって遡りながら取得。
"""

import time
from datetime import date, timedelta
from typing import Any, TypedDict

from pipelines.db.raw_client import upsert_raw_batch, RawRecord
from pipelines.lib.logger import setup_logger
from pipelines.services.toggl_track.api_client import fetch_all_detailed_report

logger = setup_logger(__name__)

TABLE_NAME = "toggl_track__time_entries_report"
API_VERSION = "v3"
MAX_DAYS_PER_REQUEST = 365  # Reports APIの1年制限

# =============================================================================
# Toggl Reports API 制限（2025年9月5日以降）
# https://support.toggl.com/en/articles/11484112-api-webhook-limits
#
# 無料プラン制限:
# - 30リクエスト/時間/ユーザー/組織（Workspace/Organization API）
# - 30リクエスト/時間/ユーザー（個人データAPI）
# - 402エラー: クォータ超過 or 有料機能へのアクセス
# - 60分スライディングウィンドウでリセット
#
# 注意: 大量データ取得時は402エラーが発生する可能性あり
# =============================================================================


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    count: int
    elapsed_seconds: float


def _flatten_report_entries(grouped_entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reports APIのグループ化されたレスポンスをフラット化

    Reports API v3はエントリーをグループ化して返す:
    {
        "user_id": 123,
        "project_id": 456,
        "description": "task",
        "time_entries": [
            {"id": 789, "seconds": 3600, "start": "...", ...},
            {"id": 790, "seconds": 1800, "start": "...", ...}
        ]
    }

    これをフラット化して各time_entryに親の情報をマージする。
    """
    flat_entries = []

    for group in grouped_entries:
        # 親グループの情報（time_entries以外）
        parent_info = {k: v for k, v in group.items() if k != "time_entries"}

        # 各time_entryに親情報をマージ
        time_entries = group.get("time_entries") or []
        for entry in time_entries:
            merged = {**parent_info, **entry}
            flat_entries.append(merged)

    return flat_entries


def _to_raw_record(entry: dict[str, Any]) -> RawRecord:
    """APIレスポンスをRawRecordに変換

    Reports APIのレスポンスはTrack APIと構造が異なる。
    source_idはエントリーIDを使用。
    """
    entry_id = entry.get("id")
    if not entry_id:
        raise ValueError(f"Entry missing id field: {entry}")

    return RawRecord(
        source_id=str(entry_id),
        data=entry,
    )


def _split_date_range_reverse(start_d: date, end_d: date) -> list[tuple[date, date]]:
    """日付範囲を1年以内のチャンクに分割（終了日から遡る）

    Args:
        start_d: 開始日
        end_d: 終了日

    Returns:
        (開始日, 終了日)のタプルのリスト（新しい順）
    """
    chunks = []
    current_end = end_d

    while current_end > start_d:
        # 1年前または開始日のいずれか遅い方
        current_start = max(current_end - timedelta(days=MAX_DAYS_PER_REQUEST), start_d)
        chunks.append((current_start, current_end))
        current_end = current_start

    return chunks


async def sync_time_entries_report(
    start_date: str | None = None,
    end_date: str | None = None,
    days: int | None = None,
) -> SyncResult:
    """タイムエントリーを同期（Reports API v3）

    1年以上の期間を指定した場合、自動的に1年ごとに分割して取得。
    終了日から開始日に向かって遡りながら取得。

    Args:
        start_date: 開始日（YYYY-MM-DD）
        end_date: 終了日（YYYY-MM-DD）
        days: 日数（start_date/end_dateが未指定の場合に使用）

    Returns:
        同期結果
    """
    start_time = time.perf_counter()

    # 日付範囲を決定（end_dateは翌日にして当日分を確実に取得）
    if start_date and end_date:
        start_d = date.fromisoformat(start_date)
        end_d = date.fromisoformat(end_date)
    elif days:
        end_d = date.today() + timedelta(days=1)
        start_d = date.today() - timedelta(days=days - 1)
    else:
        # デフォルト: 過去1年
        end_d = date.today() + timedelta(days=1)
        start_d = date.today() - timedelta(days=365)

    logger.info(f"Starting Toggl time entries report sync ({start_d} to {end_d})")

    # 1年以上の場合は分割（終了日から遡る）
    date_chunks = _split_date_range_reverse(start_d, end_d)
    if len(date_chunks) > 1:
        logger.info(f"Period exceeds 1 year, splitting into {len(date_chunks)} chunks (newest first)")

    total_count = 0

    for i, (chunk_start, chunk_end) in enumerate(date_chunks):
        chunk_start_str = chunk_start.isoformat()
        chunk_end_str = chunk_end.isoformat()

        if len(date_chunks) > 1:
            logger.info(f"Fetching chunk {i + 1}/{len(date_chunks)}: {chunk_start_str} to {chunk_end_str}")

        try:
            # API からデータ取得（ページネーション対応）
            grouped_entries = await fetch_all_detailed_report(chunk_start_str, chunk_end_str)
            logger.info(f"Fetched {len(grouped_entries)} grouped entries from Reports API")

            # グループ化されたレスポンスをフラット化
            entries = _flatten_report_entries(grouped_entries)
            logger.info(f"Flattened to {len(entries)} time entries")

            # チャンクごとにDB保存（402エラー等で中断しても取得済みデータは保存される）
            if entries:
                records = [_to_raw_record(e) for e in entries]
                result = await upsert_raw_batch(TABLE_NAME, records, api_version=API_VERSION)
                total_count += result["total"]
                logger.info(f"Saved {result['total']} entries to DB (total: {total_count})")

        except Exception as e:
            elapsed = round(time.perf_counter() - start_time, 2)
            # 402エラーの場合は取得済み分を返して終了
            if "402" in str(e):
                logger.warning(
                    f"Toggl API quota exceeded (402). Saved {total_count} entries before limit. "
                    f"Free plan: 30 requests/hour. Wait 60 minutes or upgrade plan."
                )
                return SyncResult(
                    success=total_count > 0,
                    count=total_count,
                    elapsed_seconds=elapsed,
                )
            logger.error(f"Toggl time entries report sync failed after {elapsed}s: {e}")
            raise

    elapsed = round(time.perf_counter() - start_time, 2)
    logger.info(f"Toggl time entries report sync completed: {total_count} entries in {elapsed}s")

    return SyncResult(
        success=True,
        count=total_count,
        elapsed_seconds=elapsed,
    )
