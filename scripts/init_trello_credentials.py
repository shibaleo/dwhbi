#!/usr/bin/env python3
"""Trello認証情報の初期登録スクリプト

環境変数から認証情報を読み取り、Supabase Vaultに登録する。

必要な環境変数:
  - DIRECT_DATABASE_URL
  - TRELLO_API_KEY
  - TRELLO_API_TOKEN (TRELLO_API_SECRETでも可)
  - TRELLO_MEMBER_ID (オプション)

使用方法:
  python scripts/init_trello_credentials.py
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.credentials_vault import save_credentials, get_credentials


async def main():
    """メイン処理"""
    print("=== Trello認証情報の初期登録 ===\n")

    # 環境変数チェック
    api_key = os.environ.get("TRELLO_API_KEY")
    # TRELLO_API_TOKEN または TRELLO_API_SECRET を探す
    api_token = os.environ.get("TRELLO_API_TOKEN") or os.environ.get("TRELLO_API_SECRET")
    member_id = os.environ.get("TRELLO_MEMBER_ID")

    if not api_key:
        print("エラー: TRELLO_API_KEY 環境変数が設定されていません")
        sys.exit(1)

    if not api_token:
        print("エラー: TRELLO_API_TOKEN または TRELLO_API_SECRET 環境変数が設定されていません")
        sys.exit(1)

    print(f"API Key: {api_key[:8]}...{api_key[-4:]}")
    print(f"API Token: {api_token[:8]}...{api_token[-4:]}")
    print(f"Member ID: {member_id or '(未設定 - デフォルト: me)'}")
    print()

    # 認証情報を構築
    credentials = {
        "api_key": api_key,
        "api_token": api_token,
    }

    if member_id:
        credentials["member_id"] = member_id

    # Vaultに保存
    print("Vaultに認証情報を保存中...")
    await save_credentials(
        service="trello",
        credentials=credentials,
        auth_type="api_key",
        expires_at=None,  # Trelloトークンは無期限
        description="Trello API credentials"
    )

    print("\n✅ 認証情報を正常に登録しました！")
    print("   サービス: trello")
    print("   有効期限: なし（永続トークン）")

    # 確認のため読み戻し
    print("\n確認のため読み戻し中...")
    result = await get_credentials("trello")
    if result["credentials"]:
        print("   認証情報キー:", list(result["credentials"].keys()))
        print("\n✅ 検証完了！")
    else:
        print("⚠️ 読み戻しに失敗しましたが、登録自体は成功している可能性があります")


if __name__ == "__main__":
    asyncio.run(main())
