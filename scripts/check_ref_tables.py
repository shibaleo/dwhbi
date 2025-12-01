"""refスキーマのテーブル構造を確認するスクリプト"""

import os
import httpx
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Accept-Profile": "ref",
}

tables = [
    "toggl_colors",
    "gcalendar_colors",
    "color_mapping",
    "expense_categories",
    "expense_qualities",
    "zaim_category_to_quality",
    "zaim_genre_to_category",
]

with httpx.Client(timeout=30.0) as client:
    for table_name in tables:
        endpoint = f"{url}/rest/v1/{table_name}?limit=1"
        print(f"\n=== {table_name} ===")

        resp = client.get(endpoint, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            if data:
                print(f"Columns: {list(data[0].keys())}")
                # avoid unicode issues on Windows
                import json
                print(f"Sample: {json.dumps(data[0], ensure_ascii=True)}")
            else:
                print("(empty table)")
        else:
            print(f"Error: {resp.status_code} - {resp.text}")
