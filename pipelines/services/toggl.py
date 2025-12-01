"""Toggl Track API 同期

Toggl API v9 を使用して時間エントリーを取得し、raw.toggl_entries に保存する。
"""

import base64
from datetime import date, timedelta
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials import get_credentials
from pipelines.lib.db import get_supabase_client
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Types
# =============================================================================


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


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    entries: int


# =============================================================================
# Configuration
# =============================================================================

BASE_URL = "https://api.track.toggl.com/api/v9"
MAX_RETRIES = 3
RETRY_DELAY_MS = 2000


# =============================================================================
# Authentication
# =============================================================================


async def get_auth_headers() -> dict[str, str]:
    """Toggl API 認証ヘッダーを取得

    Returns:
        Basic認証ヘッダー

    Raises:
        ValueError: 認証情報が不正
    """
    result = await get_credentials("toggl")
    credentials = result["credentials"]

    api_token = credentials.get("api_token")
    if not api_token:
        raise ValueError("Toggl credentials missing api_token")

    # Basic認証: api_token:api_token をBase64エンコード
    auth_string = f"{api_token}:api_token"
    encoded = base64.b64encode(auth_string.encode()).decode()

    return {
        "Content-Type": "application/json",
        "Authorization": f"Basic {encoded}",
    }


# =============================================================================
# API Client
# =============================================================================


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


def to_db_entry(entry: TogglTimeEntry) -> DbEntry:
    """API型 → DB型への変換

    実行中エントリー（duration < 0）は除外される前提。
    呼び出し側でフィルタリングすること。

    Args:
        entry: Toggl API レスポンス

    Returns:
        DBレコード形式
    """
    return DbEntry(
        id=entry["id"],
        workspace_id=entry["workspace_id"],
        project_id=entry.get("project_id"),
        task_id=entry.get("task_id"),
        user_id=entry["user_id"],
        description=entry.get("description"),
        start=entry["start"],
        end=entry.get("stop") or entry["start"],  # stopがNoneの場合はstartで代用
        duration_ms=entry["duration"] * 1000,
        is_billable=entry.get("billable", False),
        billable_amount=None,  # Reports APIのみで取得可能
        currency=None,
        tags=entry.get("tags", []),
        updated_at=entry["at"],
    )


# =============================================================================
# DB Write
# =============================================================================


async def upsert_entries(entries: list[TogglTimeEntry]) -> int:
    """エントリーを raw.toggl_entries に upsert

    Args:
        entries: API レスポンスのエントリーリスト

    Returns:
        保存件数
    """
    if not entries:
        return 0

    # 実行中エントリー（duration < 0）を除外
    completed_entries = [e for e in entries if e["duration"] >= 0]

    if not completed_entries:
        logger.info("No completed entries to save (all running)")
        return 0

    records = [to_db_entry(e) for e in completed_entries]

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
    logger.info(f"Starting Toggl sync ({days} days)")

    # 日付範囲を計算
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    logger.info(f"Fetching entries from {start_str} to {end_str}")

    # 1. API からデータ取得
    entries = await fetch_entries_by_range(start_str, end_str)
    logger.info(f"Fetched {len(entries)} entries from Toggl API")

    # 2. DB に保存
    saved_count = await upsert_entries(entries)

    logger.info(f"Toggl sync completed: {saved_count} entries saved")

    return SyncResult(
        success=True,
        entries=saved_count
    )
