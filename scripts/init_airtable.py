#!/usr/bin/env python3
"""Airtable 認証情報初期化スクリプト

環境変数から Personal Access Token を取得し、
Supabase Vault に保存する。

必要な環境変数:
  - DIRECT_DATABASE_URL
  - AIRTABLE_PERSONAL_ACCESS_TOKEN

使用方法:
  python scripts/init_airtable.py
"""

import asyncio
import os
import sys

import httpx
from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.credentials_vault import save_credentials


async def main():
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

    # 認証情報をVaultに保存
    print("\nVaultに認証情報を保存中...")
    credentials = {
        "personal_access_token": token,
    }

    await save_credentials(
        service="airtable",
        credentials=credentials,
        auth_type="personal_access_token",
        expires_at=None,  # PAT には有効期限がない
        description="Airtable Personal Access Token"
    )

    print("認証情報を保存しました！")

    # 動作確認（ベース一覧を取得）
    print("\n動作確認中...")
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
    print("  同期を実行: python -c \"import asyncio; from pipelines.services.airtable import sync_airtable; asyncio.run(sync_airtable())\"")


if __name__ == "__main__":
    asyncio.run(main())
