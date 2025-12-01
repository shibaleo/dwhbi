"""認証情報の取得・復号"""

from datetime import datetime
from typing import Any, TypedDict

from pipelines.lib.db import get_supabase_client
from pipelines.lib.encryption import decrypt_credentials, encrypt_credentials, hex_to_bytes, bytes_to_hex


class CredentialsResult(TypedDict):
    """認証情報取得結果"""
    credentials: dict[str, Any]
    expires_at: datetime | None


async def get_credentials(service: str) -> CredentialsResult:
    """credentials.servicesから認証情報を取得・復号

    Args:
        service: サービス識別子（"toggl", "fitbit", etc.）

    Returns:
        復号された認証情報と有効期限

    Raises:
        ValueError: 認証情報が見つからない
    """
    supabase = get_supabase_client()

    # credentials.services から取得
    result = (
        supabase.schema("credentials")
        .table("services")
        .select("credentials_encrypted, expires_at")
        .eq("service", service)
        .single()
        .execute()
    )

    if not result.data:
        raise ValueError(f"Credentials not found for service: {service}")

    # 暗号化データを復号
    encrypted_hex = result.data["credentials_encrypted"]
    encrypted_bytes = hex_to_bytes(encrypted_hex)
    credentials = decrypt_credentials(encrypted_bytes)

    # expires_at をdatetimeに変換
    expires_at = None
    if result.data.get("expires_at"):
        expires_at = datetime.fromisoformat(result.data["expires_at"].replace("Z", "+00:00"))

    return CredentialsResult(
        credentials=credentials,
        expires_at=expires_at
    )


async def update_credentials(
    service: str,
    updates: dict[str, Any],
    expires_at: datetime | None = None,
) -> None:
    """credentials.servicesの認証情報を部分更新

    Args:
        service: サービス識別子（"toggl", "fitbit", etc.）
        updates: 更新するフィールド（既存の認証情報にマージ）
        expires_at: 新しい有効期限（Noneの場合は更新しない）

    Raises:
        ValueError: 認証情報が見つからない
    """
    # 既存の認証情報を取得
    current = await get_credentials(service)
    current_creds = current["credentials"]

    # 更新をマージ
    merged = {**current_creds, **updates}

    # 暗号化
    encrypted_bytes = encrypt_credentials(merged)
    encrypted_hex = bytes_to_hex(encrypted_bytes)

    # DBを更新
    supabase = get_supabase_client()
    update_data: dict[str, Any] = {
        "credentials_encrypted": encrypted_hex,
        "updated_at": datetime.now().isoformat(),
    }
    if expires_at is not None:
        update_data["expires_at"] = expires_at.isoformat()

    supabase.schema("credentials").table("services").update(update_data).eq(
        "service", service
    ).execute()
