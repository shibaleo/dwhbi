"""
Supabase ref スキーマのテーブルを Airtable にコピーするスクリプト

使用方法:
    python scripts/copy_ref_to_airtable.py

必要な環境変数:
    SUPABASE_URL: Supabase プロジェクトURL
    SUPABASE_SERVICE_ROLE_KEY: Supabase サービスロールキー
    AIRTABLE_PERSONAL_ACCESS_TOKEN: Airtable Personal Access Token
    AIRTABLE_BASE_ID: Airtable ベースID
"""

import os
import sys

import httpx
from dotenv import load_dotenv

# .envファイルを読み込み
load_dotenv()


# refスキーマの全テーブル定義
REF_TABLES = [
    "toggl_colors",
    "gcalendar_colors",
    "color_mapping",
    "expense_categories",
    "expense_qualities",
    "zaim_category_to_quality",
    "zaim_genre_to_category",
]

# Airtableテーブル設定
AIRTABLE_TABLE_CONFIGS = {
    "ref_toggl_colors": {
        "name": "ref_toggl_colors",
        "description": "Toggl Track 無料プランで使用可能な色一覧",
        "fields": [
            {"name": "id", "type": "number", "options": {"precision": 0}},
            {"name": "hex", "type": "singleLineText"},
            {"name": "name", "type": "singleLineText"},
            {"name": "sort_order", "type": "number", "options": {"precision": 0}},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
    "ref_gcalendar_colors": {
        "name": "ref_gcalendar_colors",
        "description": "Google Calendar のイベント色一覧",
        "fields": [
            {"name": "id", "type": "singleLineText"},
            {"name": "hex", "type": "singleLineText"},
            {"name": "name", "type": "singleLineText"},
            {"name": "sort_order", "type": "number", "options": {"precision": 0}},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
    "ref_color_mapping": {
        "name": "ref_color_mapping",
        "description": "Toggl と Google Calendar の色マッピング",
        "fields": [
            {"name": "id", "type": "number", "options": {"precision": 0}},
            {"name": "toggl_color_hex", "type": "singleLineText"},
            {"name": "gcalendar_color_id", "type": "singleLineText"},
            {"name": "name", "type": "singleLineText"},
            {"name": "notes", "type": "singleLineText"},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
    "ref_expense_categories": {
        "name": "ref_expense_categories",
        "description": "支出カテゴリマスタ",
        "fields": [
            {"name": "id", "type": "number", "options": {"precision": 0}},
            {"name": "name", "type": "singleLineText"},
            {"name": "ja_name", "type": "singleLineText"},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
    "ref_expense_qualities": {
        "name": "ref_expense_qualities",
        "description": "支出品質マスタ（日常必需/自己投資/浪費など）",
        "fields": [
            {"name": "id", "type": "number", "options": {"precision": 0}},
            {"name": "name", "type": "singleLineText"},
            {"name": "ja_name", "type": "singleLineText"},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
    "ref_zaim_category_to_quality": {
        "name": "ref_zaim_category_to_quality",
        "description": "Zaimカテゴリから支出品質へのマッピング",
        "fields": [
            {"name": "id", "type": "number", "options": {"precision": 0}},
            {"name": "zaim_category_id", "type": "number", "options": {"precision": 0}},
            {"name": "expense_quality_id", "type": "number", "options": {"precision": 0}},
            {"name": "notes", "type": "singleLineText"},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
    "ref_zaim_genre_to_category": {
        "name": "ref_zaim_genre_to_category",
        "description": "Zaimジャンルから支出カテゴリへのマッピング",
        "fields": [
            {"name": "id", "type": "number", "options": {"precision": 0}},
            {"name": "zaim_genre_id", "type": "number", "options": {"precision": 0}},
            {"name": "expense_category_id", "type": "number", "options": {"precision": 0}},
            {"name": "notes", "type": "singleLineText"},
            {"name": "created_at", "type": "dateTime", "options": {"timeZone": "Asia/Tokyo", "dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}}},
        ],
    },
}

# Supabaseテーブル名 -> Airtableテーブル名のマッピング
TABLE_NAME_MAP = {
    "toggl_colors": "ref_toggl_colors",
    "gcalendar_colors": "ref_gcalendar_colors",
    "color_mapping": "ref_color_mapping",
    "expense_categories": "ref_expense_categories",
    "expense_qualities": "ref_expense_qualities",
    "zaim_category_to_quality": "ref_zaim_category_to_quality",
    "zaim_genre_to_category": "ref_zaim_genre_to_category",
}


def get_supabase_client() -> tuple[str, dict]:
    """Supabase接続情報を取得"""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    return url, headers


def fetch_ref_data(client: httpx.Client, url: str, headers: dict) -> dict:
    """refスキーマの全テーブルデータを取得

    Supabase REST APIでは、スキーマを指定するために Accept-Profile ヘッダーを使用
    """
    tables = {name: [] for name in REF_TABLES}

    # refスキーマにアクセスするためのヘッダーを追加
    ref_headers = {**headers, "Accept-Profile": "ref"}

    for table_name in REF_TABLES:
        endpoint = f"{url}/rest/v1/{table_name}"
        print(f"Fetching {table_name}...")

        resp = client.get(endpoint, headers=ref_headers)
        resp.raise_for_status()
        tables[table_name] = resp.json()
        print(f"  -> {len(tables[table_name])} records")

    return tables


def get_airtable_headers() -> dict:
    """Airtable API ヘッダーを取得"""
    token = os.environ.get("AIRTABLE_PERSONAL_ACCESS_TOKEN")
    if not token:
        raise ValueError("AIRTABLE_PERSONAL_ACCESS_TOKEN is required")

    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def create_airtable_table(
    client: httpx.Client, base_id: str, headers: dict, table_config: dict
) -> str | None:
    """Airtableにテーブルを作成

    Args:
        client: httpx.Client
        base_id: Airtable ベースID
        headers: API ヘッダー
        table_config: テーブル設定 (name, fields)

    Returns:
        作成されたテーブルID、または既に存在する場合はNone
    """
    url = f"https://api.airtable.com/v0/meta/bases/{base_id}/tables"

    resp = client.post(url, headers=headers, json=table_config)

    if resp.status_code == 422:
        # テーブルが既に存在する場合
        error_data = resp.json()
        if "DUPLICATE_TABLE_NAME" in str(error_data):
            print(f"  Table '{table_config['name']}' already exists, skipping creation")
            return None
        resp.raise_for_status()

    resp.raise_for_status()
    result = resp.json()
    return result.get("id")


def get_existing_tables(client: httpx.Client, base_id: str, headers: dict) -> dict:
    """既存のテーブル一覧を取得（フィールド情報も含む）"""
    url = f"https://api.airtable.com/v0/meta/bases/{base_id}/tables"
    resp = client.get(url, headers=headers)
    resp.raise_for_status()

    tables = {}
    for table in resp.json().get("tables", []):
        field_names = [f["name"] for f in table.get("fields", [])]
        tables[table["name"]] = {
            "id": table["id"],
            "fields": field_names,
        }

    return tables


def get_record_count(client: httpx.Client, base_id: str, table_id: str, headers: dict) -> int:
    """テーブル内のレコード数を取得"""
    url = f"https://api.airtable.com/v0/{base_id}/{table_id}?maxRecords=1"
    resp = client.get(url, headers=headers)
    if resp.status_code == 200:
        data = resp.json()
        # offsetがあれば複数レコードがある
        records = data.get("records", [])
        return len(records)  # 簡易チェック
    return 0


def insert_airtable_records(
    client: httpx.Client,
    base_id: str,
    table_id_or_name: str,
    headers: dict,
    records: list[dict],
) -> int:
    """Airtableにレコードを挿入

    Args:
        client: httpx.Client
        base_id: Airtable ベースID
        table_id_or_name: テーブルIDまたは名前
        headers: API ヘッダー
        records: 挿入するレコード (fields形式)

    Returns:
        挿入されたレコード数
    """
    url = f"https://api.airtable.com/v0/{base_id}/{table_id_or_name}"

    # Airtableは1回に10件までしか挿入できない
    batch_size = 10
    total_inserted = 0

    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        payload = {"records": [{"fields": r} for r in batch]}

        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code != 200:
            print(f"  Error inserting records: {resp.status_code}")
            print(f"  Response: {resp.text}")
        resp.raise_for_status()

        result = resp.json()
        total_inserted += len(result.get("records", []))

    return total_inserted


def format_datetime(dt_str: str | None) -> str | None:
    """ISO形式の日時文字列をAirtable形式に変換"""
    if not dt_str:
        return None
    # Airtableはそのままの ISO 8601 形式を受け付ける
    return dt_str


def convert_record_for_airtable(supabase_table: str, record: dict) -> dict:
    """Supabaseのレコードを Airtable用に変換"""
    # 共通: created_atの変換
    result = {}

    for key, value in record.items():
        if key == "created_at":
            result[key] = format_datetime(value)
        else:
            result[key] = value

    return result


def main():
    """メイン処理"""
    print("=" * 60)
    print("Supabase ref schema -> Airtable copy script")
    print("=" * 60)

    # 環境変数チェック
    base_id = os.environ.get("AIRTABLE_BASE_ID")
    if not base_id:
        print("Error: AIRTABLE_BASE_ID is required")
        sys.exit(1)

    # Supabase からデータ取得
    print("\n[1/3] Fetching data from Supabase...")
    supabase_url, supabase_headers = get_supabase_client()

    with httpx.Client(timeout=30.0) as client:
        ref_data = fetch_ref_data(client, supabase_url, supabase_headers)

    # Airtable にテーブル作成
    print("\n[2/3] Creating tables in Airtable...")
    airtable_headers = get_airtable_headers()

    with httpx.Client(timeout=30.0) as client:
        # 既存テーブルを確認
        existing_tables = get_existing_tables(client, base_id, airtable_headers)
        print(f"  Existing tables: {list(existing_tables.keys())}")

        # テーブル作成
        table_ids = {}
        tables_with_data = set()  # 既にデータがあるテーブル
        for airtable_name, config in AIRTABLE_TABLE_CONFIGS.items():
            if config["name"] in existing_tables:
                table_info = existing_tables[config["name"]]
                print(f"  Table '{config['name']}' already exists (ID: {table_info['id']})")
                table_ids[config["name"]] = table_info["id"]
                # 既存テーブルにデータがあるかチェック
                if get_record_count(client, base_id, table_info["id"], airtable_headers) > 0:
                    tables_with_data.add(config["name"])
                    print(f"    -> Has existing data, will skip insert")
            else:
                print(f"  Creating table '{config['name']}'...")
                table_id = create_airtable_table(client, base_id, airtable_headers, config)
                if table_id:
                    existing_tables[config["name"]] = {"id": table_id, "fields": []}
                    table_ids[config["name"]] = table_id
                    print(f"    -> Created: {table_id}")

        # データ挿入
        print("\n[3/3] Inserting records...")

        for supabase_table, airtable_table in TABLE_NAME_MAP.items():
            table_id = table_ids.get(airtable_table)
            if not table_id:
                print(f"  {airtable_table}: skipped (no table ID)")
                continue

            # 既にデータがあるテーブルはスキップ
            if airtable_table in tables_with_data:
                print(f"  {airtable_table}: skipped (already has data)")
                continue

            records = [
                convert_record_for_airtable(supabase_table, r)
                for r in ref_data[supabase_table]
            ]

            if records:
                count = insert_airtable_records(
                    client, base_id, table_id, airtable_headers, records
                )
                print(f"  {airtable_table}: {count} records inserted")
            else:
                print(f"  {airtable_table}: 0 records (empty)")

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)


if __name__ == "__main__":
    main()
