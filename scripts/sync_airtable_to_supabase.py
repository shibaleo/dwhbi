"""
Airtable のテーブルデータを Supabase raw スキーマに同期するスクリプト

使用方法:
    python scripts/sync_airtable_to_supabase.py

必要な環境変数:
    SUPABASE_URL: Supabase プロジェクトURL
    SUPABASE_SERVICE_ROLE_KEY: Supabase サービスロールキー
    AIRTABLE_PERSONAL_ACCESS_TOKEN: Airtable Personal Access Token
    AIRTABLE_BASE_ID: Airtable ベースID

保存先テーブル:
    raw.airtable_bases   - ベース情報
    raw.airtable_tables  - テーブル情報（スキーマ含む）
    raw.airtable_records - 全レコード
"""

import json
import os
import sys
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()


def get_env_or_exit(name: str) -> str:
    """環境変数を取得、なければ終了"""
    value = os.environ.get(name)
    if not value:
        print(f"Error: {name} is required")
        sys.exit(1)
    return value


def get_airtable_headers() -> dict:
    """Airtable API ヘッダー"""
    token = get_env_or_exit("AIRTABLE_PERSONAL_ACCESS_TOKEN")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def get_supabase_headers() -> dict:
    """Supabase API ヘッダー"""
    key = get_env_or_exit("SUPABASE_SERVICE_ROLE_KEY")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",  # UPSERT
    }


def fetch_airtable_base_info(client: httpx.Client, base_id: str, headers: dict) -> dict | None:
    """ベース情報を取得（権限がなければNone）"""
    # まず /meta/bases でベース一覧を取得して該当ベースを探す
    url = "https://api.airtable.com/v0/meta/bases"
    resp = client.get(url, headers=headers)
    if resp.status_code != 200:
        return None

    bases = resp.json().get("bases", [])
    for base in bases:
        if base.get("id") == base_id:
            return base

    return None


def fetch_airtable_tables(client: httpx.Client, base_id: str, headers: dict) -> list[dict]:
    """テーブル一覧（スキーマ含む）を取得"""
    url = f"https://api.airtable.com/v0/meta/bases/{base_id}/tables"
    resp = client.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json().get("tables", [])


def fetch_airtable_records(
    client: httpx.Client, base_id: str, table_id: str, headers: dict
) -> list[dict]:
    """テーブルの全レコードを取得（ページネーション対応）"""
    all_records = []
    url = f"https://api.airtable.com/v0/{base_id}/{table_id}"
    offset = None

    while True:
        params = {}
        if offset:
            params["offset"] = offset

        resp = client.get(url, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()

        records = data.get("records", [])
        all_records.extend(records)

        offset = data.get("offset")
        if not offset:
            break

    return all_records


def upsert_to_supabase(
    client: httpx.Client,
    supabase_url: str,
    headers: dict,
    table: str,
    records: list[dict],
) -> int:
    """Supabase に UPSERT"""
    if not records:
        return 0

    # rawスキーマにアクセス
    raw_headers = {**headers, "Content-Profile": "raw"}
    url = f"{supabase_url}/rest/v1/{table}"

    # バッチ処理（1000件ずつ）
    batch_size = 1000
    total = 0

    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        resp = client.post(url, headers=raw_headers, json=batch)
        if resp.status_code not in (200, 201):
            print(f"  Error: {resp.status_code} - {resp.text[:200]}")
        resp.raise_for_status()
        total += len(batch)

    return total


def main():
    print("=" * 60)
    print("Airtable -> Supabase sync script")
    print("=" * 60)

    base_id = get_env_or_exit("AIRTABLE_BASE_ID")
    supabase_url = get_env_or_exit("SUPABASE_URL")

    airtable_headers = get_airtable_headers()
    supabase_headers = get_supabase_headers()

    now = datetime.now(timezone.utc).isoformat()

    with httpx.Client(timeout=60.0) as client:
        # 1. ベース情報を取得・保存
        print("\n[1/3] Fetching base info...")
        base_info = fetch_airtable_base_info(client, base_id, airtable_headers)

        base_name = base_info.get("name", "Unknown") if base_info else "Unknown"
        permission_level = base_info.get("permissionLevel", "read") if base_info else "read"

        base_record = {
            "id": base_id,
            "name": base_name,
            "permission_level": permission_level,
            "synced_at": now,
        }
        upsert_to_supabase(
            client, supabase_url, supabase_headers, "airtable_bases", [base_record]
        )
        print(f"  Base: {base_name} ({base_id})")

        # 2. テーブル情報を取得・保存
        print("\n[2/3] Fetching tables...")
        tables = fetch_airtable_tables(client, base_id, airtable_headers)

        table_records = []
        for t in tables:
            table_records.append({
                "id": t["id"],
                "base_id": base_id,
                "name": t["name"],
                "primary_field_id": t.get("primaryFieldId"),
                "fields": json.dumps(t.get("fields", [])),
                "views": json.dumps(t.get("views", [])),
                "synced_at": now,
            })
            print(f"  - {t['name']} ({t['id']})")

        upsert_to_supabase(
            client, supabase_url, supabase_headers, "airtable_tables", table_records
        )
        print(f"  -> {len(table_records)} tables saved")

        # 3. 各テーブルのレコードを取得・保存
        print("\n[3/3] Fetching records...")

        all_records = []
        for t in tables:
            table_id = t["id"]
            table_name = t["name"]

            records = fetch_airtable_records(client, base_id, table_id, airtable_headers)
            print(f"  - {table_name}: {len(records)} records")

            for r in records:
                all_records.append({
                    "id": r["id"],
                    "base_id": base_id,
                    "table_id": table_id,
                    "created_time": r.get("createdTime"),
                    "fields": json.dumps(r.get("fields", {})),
                    "synced_at": now,
                })

        if all_records:
            count = upsert_to_supabase(
                client, supabase_url, supabase_headers, "airtable_records", all_records
            )
            print(f"  -> {count} records saved to Supabase")

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)


if __name__ == "__main__":
    main()
