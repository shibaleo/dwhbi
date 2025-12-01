"""Airtable API 同期

Airtable Web API を使用してベース、テーブル、レコードを取得し、
raw.airtable_* テーブルに保存する。

Personal Access Token (PAT) による認証
"""

import asyncio
import time
from datetime import datetime
from typing import Any, TypedDict

import httpx

from pipelines.lib.credentials import get_credentials
from pipelines.lib.db import get_supabase_client
from pipelines.lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Constants
# =============================================================================

BASE_URL = "https://api.airtable.com/v0"
META_URL = "https://api.airtable.com/v0/meta"
PAGE_SIZE = 100  # Airtable default max
RATE_LIMIT_DELAY = 0.2  # 5 requests per second limit


# =============================================================================
# Types
# =============================================================================


class AirtableBase(TypedDict):
    """Airtable API Base レスポンス"""
    id: str
    name: str
    permissionLevel: str


class AirtableTable(TypedDict):
    """Airtable API Table レスポンス"""
    id: str
    name: str
    primaryFieldId: str
    fields: list[dict[str, Any]]
    views: list[dict[str, Any]]


class AirtableRecord(TypedDict):
    """Airtable API Record レスポンス"""
    id: str
    createdTime: str
    fields: dict[str, Any]


# DB Types
class DbBase(TypedDict):
    """raw.airtable_bases テーブルレコード"""
    id: str
    name: str
    permission_level: str


class DbTable(TypedDict):
    """raw.airtable_tables テーブルレコード"""
    id: str
    base_id: str
    name: str
    primary_field_id: str
    fields: list[dict[str, Any]]
    views: list[dict[str, Any]]


class DbRecord(TypedDict):
    """raw.airtable_records テーブルレコード"""
    id: str
    base_id: str
    table_id: str
    created_time: str
    fields: dict[str, Any]


class SyncStats(TypedDict):
    """同期統計"""
    bases: int
    tables: int
    records: int


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    stats: SyncStats


# =============================================================================
# Authentication
# =============================================================================

_cached_token: str | None = None


async def get_access_token() -> str:
    """Personal Access Token を取得（キャッシュ付き）"""
    global _cached_token

    if _cached_token is not None:
        return _cached_token

    result = await get_credentials("airtable")
    credentials = result["credentials"]

    token = credentials.get("personal_access_token")
    if not token:
        raise ValueError("Airtable credentials missing personal_access_token")

    _cached_token = token
    return _cached_token


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_token
    _cached_token = None


# =============================================================================
# API Client
# =============================================================================


async def fetch_bases(client: httpx.AsyncClient, token: str) -> list[AirtableBase]:
    """アクセス可能なベース一覧を取得"""
    url = f"{META_URL}/bases"
    headers = {"Authorization": f"Bearer {token}"}

    all_bases: list[AirtableBase] = []
    offset: str | None = None

    while True:
        params = {}
        if offset:
            params["offset"] = offset

        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

        all_bases.extend(data.get("bases", []))

        offset = data.get("offset")
        if not offset:
            break

        await asyncio.sleep(RATE_LIMIT_DELAY)

    return all_bases


async def fetch_tables(
    client: httpx.AsyncClient,
    token: str,
    base_id: str
) -> list[AirtableTable]:
    """ベース内のテーブル一覧を取得（スキーマ情報含む）"""
    url = f"{META_URL}/bases/{base_id}/tables"
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get(url, headers=headers)
    response.raise_for_status()
    data = response.json()

    return data.get("tables", [])


async def fetch_records(
    client: httpx.AsyncClient,
    token: str,
    base_id: str,
    table_id: str,
    view: str | None = None
) -> list[AirtableRecord]:
    """テーブル内のレコード一覧を取得（ページネーション対応）"""
    url = f"{BASE_URL}/{base_id}/{table_id}"
    headers = {"Authorization": f"Bearer {token}"}

    all_records: list[AirtableRecord] = []
    offset: str | None = None

    while True:
        params: dict[str, Any] = {"pageSize": PAGE_SIZE}
        if offset:
            params["offset"] = offset
        if view:
            params["view"] = view

        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

        all_records.extend(data.get("records", []))

        offset = data.get("offset")
        if not offset:
            break

        await asyncio.sleep(RATE_LIMIT_DELAY)

    return all_records


# =============================================================================
# DB Transformation
# =============================================================================


def to_db_base(base: AirtableBase) -> DbBase:
    """API Base → DB Base"""
    return DbBase(
        id=base["id"],
        name=base["name"],
        permission_level=base.get("permissionLevel", "read"),
    )


def to_db_table(table: AirtableTable, base_id: str) -> DbTable:
    """API Table → DB Table"""
    return DbTable(
        id=table["id"],
        base_id=base_id,
        name=table["name"],
        primary_field_id=table.get("primaryFieldId", ""),
        fields=table.get("fields", []),
        views=table.get("views", []),
    )


def to_db_record(record: AirtableRecord, base_id: str, table_id: str) -> DbRecord:
    """API Record → DB Record"""
    return DbRecord(
        id=record["id"],
        base_id=base_id,
        table_id=table_id,
        created_time=record["createdTime"],
        fields=record.get("fields", {}),
    )


# =============================================================================
# DB Write
# =============================================================================


async def upsert_bases(bases: list[AirtableBase]) -> int:
    """ベースを raw.airtable_bases に upsert"""
    if not bases:
        return 0

    records = [to_db_base(b) for b in bases]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("airtable_bases")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} bases to raw.airtable_bases")
    return saved_count


async def upsert_tables(tables: list[DbTable]) -> int:
    """テーブルを raw.airtable_tables に upsert"""
    if not tables:
        return 0

    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("airtable_tables")
        .upsert(tables, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} tables to raw.airtable_tables")
    return saved_count


async def upsert_records(records: list[DbRecord]) -> int:
    """レコードを raw.airtable_records に upsert"""
    if not records:
        return 0

    supabase = get_supabase_client()

    # バッチ処理（1000件ずつ）
    batch_size = 1000
    saved_count = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        result = (
            supabase.schema("raw")
            .table("airtable_records")
            .upsert(batch, on_conflict="id")
            .execute()
        )
        saved_count += len(result.data) if result.data else 0

    logger.info(f"Saved {saved_count} records to raw.airtable_records")
    return saved_count


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_airtable(
    base_ids: list[str] | None = None,
    include_records: bool = True
) -> SyncResult:
    """Airtable データを同期

    Args:
        base_ids: 同期対象のベースID（Noneの場合は全ベース）
        include_records: レコードを取得するか（Falseならスキーマのみ）
    """
    total_start = time.perf_counter()
    logger.info(f"Starting Airtable sync (include_records={include_records})")

    token = await get_access_token()

    all_bases: list[AirtableBase] = []
    all_tables: list[DbTable] = []
    all_records: list[DbRecord] = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. ベース一覧を取得
        logger.info("Fetching bases...")
        fetched_bases = await fetch_bases(client, token)

        # フィルタリング
        if base_ids:
            all_bases = [b for b in fetched_bases if b["id"] in base_ids]
            logger.info(f"Filtered to {len(all_bases)} bases (from {len(fetched_bases)})")
        else:
            all_bases = fetched_bases
            logger.info(f"Fetched {len(all_bases)} bases")

        # 2. 各ベースのテーブルとレコードを取得
        for base in all_bases:
            base_id = base["id"]
            base_name = base["name"]

            logger.info(f"Processing base '{base_name}'...")

            # テーブル一覧（スキーマ）を取得
            tables = await fetch_tables(client, token, base_id)
            db_tables = [to_db_table(t, base_id) for t in tables]
            all_tables.extend(db_tables)

            if include_records:
                # 各テーブルのレコードを取得
                for table in tables:
                    table_id = table["id"]
                    table_name = table["name"]

                    records = await fetch_records(client, token, base_id, table_id)
                    db_records = [to_db_record(r, base_id, table_id) for r in records]
                    all_records.extend(db_records)

                    logger.info(
                        f"  Table '{table_name}': {len(records)} records"
                    )

                    await asyncio.sleep(RATE_LIMIT_DELAY)

            logger.info(
                f"Base '{base_name}': {len(tables)} tables"
                + (f", {sum(1 for r in all_records if r['base_id'] == base_id)} records" if include_records else "")
            )

            await asyncio.sleep(RATE_LIMIT_DELAY)

    logger.info(
        f"Fetched {len(all_bases)} bases, {len(all_tables)} tables"
        + (f", {len(all_records)} records" if include_records else "")
    )

    # 3. DB に保存
    db_start = time.perf_counter()
    logger.info("Saving to database...")

    bases_count = await upsert_bases(all_bases)
    tables_count = await upsert_tables(all_tables)
    records_count = await upsert_records(all_records) if include_records else 0

    db_elapsed = round(time.perf_counter() - db_start, 2)

    stats = SyncStats(
        bases=bases_count,
        tables=tables_count,
        records=records_count,
    )

    total_elapsed = round(time.perf_counter() - total_start, 2)

    logger.info(
        f"Airtable sync completed in {total_elapsed}s (db: {db_elapsed}s)"
    )

    return SyncResult(
        success=True,
        stats=stats,
    )


# =============================================================================
# CLI Entry Point
# =============================================================================

if __name__ == "__main__":
    asyncio.run(sync_airtable())
