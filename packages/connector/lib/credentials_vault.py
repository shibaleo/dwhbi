"""認証情報の取得・更新 - Supabase Vault版

Supabase Vault（vault.secrets）を使用した認証情報管理。
直接DB接続で vault.create_secret() / vault.update_secret() を使用。

保存形式:
    vault.secrets.secret に JSON 文字列として保存
    {
        "client_id": "...",
        "access_token": "...",
        ...,
        "_auth_type": "oauth2",
        "_expires_at": "2024-01-01T00:00:00+00:00"
    }

必要な環境変数:
    - DIRECT_DATABASE_URL (直接DB接続用)

使用方法:
    from pipelines.lib.credentials_vault import get_credentials, update_credentials
"""

import json
import os
from datetime import datetime
from typing import Any, TypedDict

import psycopg2


class CredentialsResult(TypedDict):
    """認証情報取得結果"""
    credentials: dict[str, Any]
    expires_at: datetime | None


def _get_db_connection():
    """直接DB接続を取得"""
    database_url = os.environ.get("DIRECT_DATABASE_URL")
    if not database_url:
        raise ValueError("DIRECT_DATABASE_URL environment variable is required")
    return psycopg2.connect(database_url)


async def get_credentials(service: str) -> CredentialsResult:
    """vault.secretsから認証情報を取得

    Args:
        service: サービス識別子（"toggl", "fitbit", etc.）

    Returns:
        復号された認証情報と有効期限

    Raises:
        ValueError: 認証情報が見つからない
    """
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = %s",
                (service,)
            )
            row = cur.fetchone()

            if not row:
                raise ValueError(f"Credentials not found for service: {service}")

            decrypted = row[0]
            if decrypted is None:
                raise ValueError(f"Credentials not found for service: {service}")

            # JSON文字列をパース
            if isinstance(decrypted, str):
                data = json.loads(decrypted)
            else:
                data = decrypted

            # メタデータを抽出
            expires_at_str = data.pop("_expires_at", None)
            data.pop("_auth_type", None)

            # expires_at をdatetimeに変換
            expires_at = None
            if expires_at_str:
                expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))

            return CredentialsResult(
                credentials=data,
                expires_at=expires_at
            )
    finally:
        conn.close()


async def update_credentials(
    service: str,
    updates: dict[str, Any],
    expires_at: datetime | None = None,
) -> None:
    """vault.secretsの認証情報を部分更新

    Args:
        service: サービス識別子（"toggl", "fitbit", etc.）
        updates: 更新するフィールド（既存の認証情報にマージ）
        expires_at: 新しい有効期限（Noneの場合は既存値を保持）

    Raises:
        ValueError: 認証情報が見つからない
    """
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            # 既存の認証情報を取得
            cur.execute(
                "SELECT id, decrypted_secret FROM vault.decrypted_secrets WHERE name = %s",
                (service,)
            )
            row = cur.fetchone()

            if not row:
                raise ValueError(f"Credentials not found for service: {service}")

            secret_id = row[0]
            decrypted = row[1]

            if isinstance(decrypted, str):
                current_data = json.loads(decrypted)
            else:
                current_data = decrypted

            # メタデータを保持
            auth_type = current_data.get("_auth_type", "oauth2")
            current_expires_at = current_data.get("_expires_at")

            # メタデータ以外をマージ
            merged = {k: v for k, v in current_data.items() if not k.startswith("_")}
            merged.update(updates)

            # メタデータを追加
            merged["_auth_type"] = auth_type
            merged["_expires_at"] = expires_at.isoformat() if expires_at else current_expires_at

            # 更新
            secret_json = json.dumps(merged)
            cur.execute(
                "SELECT vault.update_secret(%s, %s, %s, %s)",
                (secret_id, secret_json, service, f"{service} credentials")
            )
            conn.commit()
    finally:
        conn.close()


async def save_credentials(
    service: str,
    credentials: dict[str, Any],
    auth_type: str = "oauth2",
    expires_at: datetime | None = None,
    description: str | None = None,
) -> None:
    """vault.secretsに新規認証情報を保存

    Args:
        service: サービス識別子（"toggl", "fitbit", etc.）
        credentials: 認証情報辞書
        auth_type: 認証方式（"oauth2", "oauth1", "basic", "api_key", "personal_access_token"）
        expires_at: 有効期限（Noneの場合は無期限）
        description: 説明（Noneの場合はデフォルト値）
    """
    vault_data = {
        **credentials,
        "_auth_type": auth_type,
        "_expires_at": expires_at.isoformat() if expires_at else None,
    }
    secret_json = json.dumps(vault_data)
    desc = description or f"{service} credentials"

    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            # 既存チェック
            cur.execute(
                "SELECT id FROM vault.secrets WHERE name = %s",
                (service,)
            )
            existing = cur.fetchone()

            if existing:
                cur.execute(
                    "SELECT vault.update_secret(%s, %s, %s, %s)",
                    (existing[0], secret_json, service, desc)
                )
            else:
                cur.execute(
                    "SELECT vault.create_secret(%s, %s, %s)",
                    (secret_json, service, desc)
                )
            conn.commit()
    finally:
        conn.close()


async def delete_credentials(service: str) -> None:
    """認証情報を削除

    Args:
        service: サービス識別子
    """
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM vault.secrets WHERE name = %s", (service,))
            conn.commit()
    finally:
        conn.close()


async def list_services() -> list[dict[str, Any]]:
    """登録されている全サービスの一覧を取得

    Returns:
        サービス情報のリスト（認証情報は含まない）
    """
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, decrypted_secret, created_at, updated_at FROM vault.decrypted_secrets"
            )
            rows = cur.fetchall()

            services = []
            for row in rows:
                name, decrypted, created_at, updated_at = row
                if isinstance(decrypted, str):
                    data = json.loads(decrypted)
                else:
                    data = decrypted or {}

                services.append({
                    "service": name,
                    "auth_type": data.get("_auth_type", "unknown"),
                    "expires_at": data.get("_expires_at"),
                    "created_at": created_at,
                    "updated_at": updated_at,
                })

            return services
    finally:
        conn.close()
