"""AES-GCM 暗号化・復号"""

import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


_encryption_key: bytes | None = None


def get_encryption_key() -> bytes:
    """環境変数から暗号化キーを取得（キャッシュ付き）

    Returns:
        32バイトの暗号化キー

    Raises:
        ValueError: TOKEN_ENCRYPTION_KEY環境変数が未設定、または長さが不正
    """
    global _encryption_key

    if _encryption_key is not None:
        return _encryption_key

    key_b64 = os.environ.get("TOKEN_ENCRYPTION_KEY")
    if not key_b64:
        raise ValueError("TOKEN_ENCRYPTION_KEY environment variable is required")

    key_bytes = base64.b64decode(key_b64)
    if len(key_bytes) != 32:
        raise ValueError("TOKEN_ENCRYPTION_KEY must be 32 bytes (256 bits)")

    _encryption_key = key_bytes
    return _encryption_key


def encrypt_credentials(credentials: dict[str, Any]) -> bytes:
    """認証情報を暗号化

    Args:
        credentials: 認証情報辞書

    Returns:
        nonce(12バイト) + ciphertext の形式のバイト列
    """
    key = get_encryption_key()
    aesgcm = AESGCM(key)

    nonce = os.urandom(12)  # 96 bits
    plaintext = json.dumps(credentials).encode("utf-8")

    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    # nonce + ciphertext を連結
    return nonce + ciphertext


def decrypt_credentials(data: bytes) -> dict[str, Any]:
    """認証情報を復号

    Args:
        data: nonce(12バイト) + ciphertext の形式のバイト列

    Returns:
        復号された認証情報辞書
    """
    key = get_encryption_key()
    aesgcm = AESGCM(key)

    nonce = data[:12]
    ciphertext = data[12:]

    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))


def hex_to_bytes(hex_str: str) -> bytes:
    """PostgreSQL bytea hex形式 (\\x...) をbytesに変換

    Args:
        hex_str: \\x で始まるhex文字列

    Returns:
        バイト列
    """
    clean_hex = hex_str[2:] if hex_str.startswith("\\x") else hex_str
    return bytes.fromhex(clean_hex)


def bytes_to_hex(data: bytes) -> str:
    """bytesをPostgreSQL bytea hex形式 (\\x...) に変換

    Args:
        data: バイト列

    Returns:
        \\x で始まるhex文字列
    """
    return "\\x" + data.hex()
