"""Raw層への共通書き込みクライアント

全サービス共通でraw.{service}__{endpoint}テーブルへのUPSERTを行う。

使用方法:
    from db.raw_client import upsert_raw

    records = [
        {"source_id": "123", "data": {"id": 123, "name": "test"}},
        {"source_id": "456", "data": {"id": 456, "name": "test2"}},
    ]
    result = await upsert_raw("toggl_track__time_entries", records, api_version="v9")
"""

import json
import os

# ローカル開発時のみ .env を読み込む
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
from datetime import datetime, timezone
from typing import Any, TypedDict

import psycopg2
from psycopg2.extras import execute_values

from lib.logger import setup_logger

logger = setup_logger(__name__)


class UpsertResult(TypedDict):
    """UPSERT結果"""
    table: str
    inserted: int
    updated: int
    total: int


class RawRecord(TypedDict):
    """raw層レコード"""
    source_id: str
    data: dict[str, Any]


def _get_db_connection():
    """直接DB接続を取得"""
    database_url = os.environ.get("DIRECT_DATABASE_URL")
    if not database_url:
        raise ValueError("DIRECT_DATABASE_URL environment variable is required")
    return psycopg2.connect(database_url)


async def upsert_raw(
    table_name: str,
    records: list[RawRecord],
    api_version: str | None = None,
) -> UpsertResult:
    """raw層テーブルにUPSERT

    Args:
        table_name: テーブル名（スキーマなし、例: "toggl_track__time_entries"）
        records: source_idとdataを含むレコードのリスト
        api_version: APIバージョン（省略時はテーブルのデフォルト値）

    Returns:
        UPSERT結果（inserted/updated/total）
    """
    if not records:
        return UpsertResult(table=table_name, inserted=0, updated=0, total=0)

    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            now = datetime.now(timezone.utc).isoformat()

            # VALUES句のデータを準備
            values = []
            for record in records:
                source_id = str(record["source_id"])
                data_json = json.dumps(record["data"], ensure_ascii=False)
                values.append((source_id, data_json, now, api_version))

            # UPSERT実行（ON CONFLICT DO UPDATE）
            sql = f"""
                INSERT INTO raw.{table_name} (source_id, data, synced_at, api_version)
                VALUES %s
                ON CONFLICT (source_id) DO UPDATE SET
                    data = EXCLUDED.data,
                    synced_at = EXCLUDED.synced_at,
                    api_version = COALESCE(EXCLUDED.api_version, raw.{table_name}.api_version)
            """

            execute_values(cur, sql, values)
            conn.commit()

            total = len(records)
            logger.info(f"Upserted {total} records to raw.{table_name}")

            return UpsertResult(
                table=table_name,
                inserted=total,  # 厳密な区別は不要
                updated=0,
                total=total,
            )
    finally:
        conn.close()


async def upsert_raw_batch(
    table_name: str,
    records: list[RawRecord],
    api_version: str | None = None,
    batch_size: int = 1000,
) -> UpsertResult:
    """大量レコードをバッチでUPSERT

    Args:
        table_name: テーブル名
        records: レコードのリスト
        api_version: APIバージョン
        batch_size: バッチサイズ（デフォルト1000）

    Returns:
        UPSERT結果
    """
    if not records:
        return UpsertResult(table=table_name, inserted=0, updated=0, total=0)

    total_count = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        result = await upsert_raw(table_name, batch, api_version)
        total_count += result["total"]

    return UpsertResult(
        table=table_name,
        inserted=total_count,
        updated=0,
        total=total_count,
    )
