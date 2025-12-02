#!/usr/bin/env python3
"""credentials.services から Supabase Vault への移行スクリプト

既存のAES-256-GCM暗号化された認証情報を復号し、
Supabase Vaultに再保存する。

前提条件:
  1. supabase/migrations/20251202000000_migrate_to_vault.sql が適用済み

必要な環境変数:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - TOKEN_ENCRYPTION_KEY  (既存の暗号化キー、復号用)
  - DIRECT_DATABASE_URL   (直接DB接続用、db.[ref].supabase.co)

使用方法:
  python scripts/migrate_credentials_to_vault.py [--dry-run]

オプション:
  --dry-run   実際のデータ移行は行わず、移行対象を表示のみ
"""

import argparse
import json
import os
import sys

import psycopg2
from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.db import get_supabase_client
from pipelines.lib.encryption import decrypt_credentials, hex_to_bytes


def get_all_credentials_from_legacy() -> list[dict]:
    """credentials.servicesから全ての認証情報を取得"""
    supabase = get_supabase_client()

    result = (
        supabase.schema("credentials")
        .table("services")
        .select("service, auth_type, credentials_encrypted, expires_at, updated_at")
        .execute()
    )

    return result.data or []


def decrypt_legacy_credentials(encrypted_hex: str) -> dict:
    """既存の暗号化形式から復号"""
    encrypted_bytes = hex_to_bytes(encrypted_hex)
    return decrypt_credentials(encrypted_bytes)


def get_db_connection():
    """直接DB接続を取得"""
    database_url = os.environ.get("DIRECT_DATABASE_URL")
    if not database_url:
        raise ValueError("DIRECT_DATABASE_URL environment variable is required")
    return psycopg2.connect(database_url)


def migrate_to_vault(service: str, credentials: dict, auth_type: str, expires_at: str | None) -> bool:
    """vault.create_secret() を使ってVaultにシークレットを保存"""
    # メタデータを credentials に含める
    vault_data = {
        **credentials,
        "_auth_type": auth_type,
        "_expires_at": expires_at,
    }
    secret_json = json.dumps(vault_data)

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # 既存のシークレットを確認
            cur.execute(
                "SELECT id FROM vault.secrets WHERE name = %s",
                (service,)
            )
            existing = cur.fetchone()

            if existing:
                # 更新 - vault.update_secret() を使用
                cur.execute(
                    "SELECT vault.update_secret(%s, %s, %s, %s)",
                    (existing[0], secret_json, service, f"{service} credentials (migrated)")
                )
            else:
                # 新規作成 - vault.create_secret() を使用
                cur.execute(
                    "SELECT vault.create_secret(%s, %s, %s)",
                    (secret_json, service, f"{service} credentials (migrated)")
                )

            conn.commit()
            return True
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def verify_migration(service: str) -> dict | None:
    """移行が正常に行われたか確認"""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name = %s",
                (service,)
            )
            row = cur.fetchone()
            if row:
                return {"name": row[0], "decrypted_secret": row[1]}
            return None
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="credentials.servicesからSupabase Vaultへ移行"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="実際の移行は行わず、移行対象を表示のみ"
    )
    parser.add_argument(
        "--service",
        type=str,
        help="特定のサービスのみ移行（指定しない場合は全て）"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Supabase Vault 移行スクリプト")
    print("=" * 60)

    if args.dry_run:
        print("\n[DRY RUN MODE] 実際のデータ移行は行いません\n")

    # 環境変数チェック
    required_vars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TOKEN_ENCRYPTION_KEY"]
    if not args.dry_run:
        required_vars.append("DIRECT_DATABASE_URL")

    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        print(f"エラー: 環境変数が設定されていません: {', '.join(missing)}")
        sys.exit(1)

    print(f"Supabase URL: {os.environ['SUPABASE_URL'][:30]}...")
    print()

    # 1. 既存の認証情報を取得
    print("1. 既存の認証情報を取得中...")
    legacy_credentials = get_all_credentials_from_legacy()

    if not legacy_credentials:
        print("   移行対象の認証情報がありません")
        sys.exit(0)

    print(f"   {len(legacy_credentials)} 件の認証情報を発見")
    print()

    # フィルタリング
    if args.service:
        legacy_credentials = [c for c in legacy_credentials if c["service"] == args.service]
        if not legacy_credentials:
            print(f"   サービス '{args.service}' が見つかりません")
            sys.exit(1)
        print(f"   フィルタ適用: {args.service}")
        print()

    # 2. 移行処理
    print("2. 移行処理を開始...")
    print("-" * 60)

    success_count = 0
    error_count = 0

    for cred in legacy_credentials:
        service = cred["service"]
        auth_type = cred["auth_type"]
        encrypted_hex = cred["credentials_encrypted"]
        expires_at = cred.get("expires_at")

        print(f"\n   [{service}]")
        print(f"   - auth_type: {auth_type}")
        print(f"   - expires_at: {expires_at or 'N/A'}")

        try:
            # 復号
            decrypted = decrypt_legacy_credentials(encrypted_hex)
            print(f"   - credentials keys: {list(decrypted.keys())}")

            if args.dry_run:
                print("   -> [DRY RUN] 移行をスキップ")
                success_count += 1
                continue

            # Vaultに保存
            migrate_to_vault(service, decrypted, auth_type, expires_at)

            # 検証
            verified = verify_migration(service)
            if verified and verified.get("decrypted_secret"):
                print("   -> 移行成功")
                success_count += 1
            else:
                print("   -> 移行失敗: 検証に失敗")
                error_count += 1

        except Exception as e:
            print(f"   -> エラー: {e}")
            error_count += 1

    print()
    print("-" * 60)
    print()

    # 3. 結果サマリー
    print("3. 移行結果サマリー")
    print(f"   成功: {success_count} 件")
    print(f"   失敗: {error_count} 件")
    print()

    if error_count == 0 and not args.dry_run:
        print("=" * 60)
        print("移行が完了しました！")
        print("=" * 60)
        print()
        print("次のステップ:")
        print("  1. pipelines/lib/credentials.py を credentials_vault.py に置換")
        print("  2. 各サービスの動作確認")
        print("  3. 問題なければ credentials スキーマを削除")
    elif args.dry_run:
        print("=" * 60)
        print("[DRY RUN] 上記の認証情報が移行対象です")
        print("=" * 60)
        print()
        print("実際に移行するには:")
        print("  python scripts/migrate_credentials_to_vault.py")
    else:
        print("=" * 60)
        print("一部の移行に失敗しました。エラーを確認してください。")
        print("=" * 60)
        sys.exit(1)


if __name__ == "__main__":
    main()
