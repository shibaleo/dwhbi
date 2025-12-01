#!/usr/bin/env python3
"""Trello認証情報の初期登録スクリプト

環境変数から認証情報を読み取り、暗号化してcredentials.servicesに登録する。

必要な環境変数:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - TOKEN_ENCRYPTION_KEY
  - TRELLO_API_KEY
  - TRELLO_API_TOKEN (TRELLO_API_SECRETでも可)
  - TRELLO_MEMBER_ID (オプション)

使用方法:
  python scripts/init_trello_credentials.py
"""

import os
import sys


from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.db import get_supabase_client
from pipelines.lib.encryption import encrypt_credentials


def main():
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

    # 暗号化
    print("認証情報を暗号化中...")
    encrypted = encrypt_credentials(credentials)
    print(f"暗号化後のサイズ: {len(encrypted)} bytes")

    # Supabaseに保存
    print("\ncredentials.servicesに保存中...")
    supabase = get_supabase_client()

    # バイナリデータをhex形式に変換（credentials.pyのhex_to_bytesと互換）
    # PostgreSQL bytea形式: \x...
    encrypted_hex = "\\x" + encrypted.hex()

    result = (
        supabase.schema("credentials")
        .table("services")
        .upsert(
            {
                "service": "trello",
                "auth_type": "api_key",  # Trelloは API Key + Token 認証
                "credentials_encrypted": encrypted_hex,
                "expires_at": None,  # Trelloトークンは無期限
            },
            on_conflict="service",
        )
        .execute()
    )

    if result.data:
        print("\n✅ 認証情報を正常に登録しました！")
        print(f"   サービス: trello")
        print(f"   有効期限: なし（永続トークン）")
    else:
        print("\n❌ 登録に失敗しました")
        sys.exit(1)

    # 確認のため読み戻し
    print("\n確認のため読み戻し中...")
    verify = (
        supabase.schema("credentials")
        .table("services")
        .select("service, auth_type, expires_at, updated_at")
        .eq("service", "trello")
        .single()
        .execute()
    )

    if verify.data:
        print(f"   認証方式: {verify.data.get('auth_type')}")
        print(f"   更新日時: {verify.data.get('updated_at')}")
        print("\n✅ 検証完了！")
    else:
        print("⚠️ 読み戻しに失敗しましたが、登録自体は成功している可能性があります")


if __name__ == "__main__":
    main()
