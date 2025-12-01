#!/usr/bin/env python3
"""Airtable 認証情報初期化スクリプト

環境変数から Personal Access Token を取得し、
credentials.services に保存する。

必要な環境変数:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - TOKEN_ENCRYPTION_KEY
  - AIRTABLE_PERSONAL_ACCESS_TOKEN

使用方法:
  python scripts/init_airtable.py
"""

import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.db import get_supabase_client
from pipelines.lib.encryption import encrypt_credentials


def main():
    """メイン処理"""
    print("=== Airtable 認証情報セットアップ ===\n")

    # 環境変数チェック
    token = os.environ.get("AIRTABLE_PERSONAL_ACCESS_TOKEN")

    if not token:
        print("エラー: AIRTABLE_PERSONAL_ACCESS_TOKEN 環境変数が設定されていません")
        print("\n設定方法:")
        print("  1. https://airtable.com/create/tokens にアクセス")
        print("  2. Personal Access Token を作成")
        print("     - スコープ: data.records:read, schema.bases:read")
        print("  3. .env ファイルに追加:")
        print("     AIRTABLE_PERSONAL_ACCESS_TOKEN=patXXX...")
        sys.exit(1)

    # トークンの形式確認
    if not token.startswith("pat"):
        print("警告: トークンが 'pat' で始まっていません。正しい形式か確認してください。")

    print(f"Token: {token[:10]}...{token[-4:]}")

    # 認証情報を暗号化
    print("\n認証情報を暗号化中...")
    credentials = {
        "personal_access_token": token,
    }

    encrypted = encrypt_credentials(credentials)
    encrypted_hex = "\\x" + encrypted.hex()

    # Supabaseに保存
    print("認証情報を保存中...")
    supabase = get_supabase_client()
    result = (
        supabase.schema("credentials")
        .table("services")
        .upsert(
            {
                "service": "airtable",
                "auth_type": "personal_access_token",
                "credentials_encrypted": encrypted_hex,
                "expires_at": None,  # PAT には有効期限がない
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="service",
        )
        .execute()
    )

    if result.data:
        print("認証情報を保存しました！")
    else:
        raise RuntimeError("認証情報の保存に失敗")

    # 動作確認（ベース一覧を取得）
    print("\n動作確認中...")
    import httpx

    response = httpx.get(
        "https://api.airtable.com/v0/meta/bases",
        headers={"Authorization": f"Bearer {token}"},
    )

    if response.status_code == 200:
        data = response.json()
        bases = data.get("bases", [])
        print(f"✅ API接続成功: {len(bases)} 個のベースにアクセス可能")
        for base in bases[:5]:  # 最大5件表示
            print(f"   - {base['name']} ({base['id']})")
        if len(bases) > 5:
            print(f"   ... 他 {len(bases) - 5} 件")
    elif response.status_code == 401:
        print("❌ 認証エラー: トークンが無効です")
        sys.exit(1)
    elif response.status_code == 403:
        print("❌ 権限エラー: schema.bases:read スコープが必要です")
        sys.exit(1)
    else:
        print(f"❌ APIエラー: {response.status_code}")
        print(f"   {response.text}")
        sys.exit(1)

    print("\n" + "=" * 50)
    print("Airtable 認証情報のセットアップが完了しました！")
    print("=" * 50)
    print("\n次のステップ:")
    print("  1. マイグレーションを適用: supabase db push")
    print("  2. 同期を実行: python -m pipelines.services.airtable")


if __name__ == "__main__":
    main()
