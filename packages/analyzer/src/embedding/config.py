"""Configuration for embedding module."""

import os
from dataclasses import dataclass

import psycopg2


@dataclass
class Config:
    database_url: str
    voyage_api_key: str
    batch_size: int = 128
    max_tokens: int = 32000  # Voyage AI voyage-3-liteの制限


def _get_voyage_api_key_from_vault(database_url: str) -> str:
    """VaultからVoyage API Keyを取得"""
    conn = psycopg2.connect(database_url)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT decrypted_secret::jsonb->>'api_key' FROM vault.decrypted_secrets WHERE name = 'voyage'"
        )
        row = cur.fetchone()
        if not row or not row[0]:
            raise ValueError("VOYAGE_API_KEY not found in vault")
        return row[0]
    finally:
        conn.close()


def load_config() -> Config:
    """環境変数から設定を読み込み"""
    database_url = os.environ.get("DIRECT_DATABASE_URL")
    if not database_url:
        raise ValueError("DIRECT_DATABASE_URL is required")

    # 環境変数にあればそれを使用、なければVaultから取得
    voyage_api_key = os.environ.get("VOYAGE_API_KEY")
    if not voyage_api_key:
        voyage_api_key = _get_voyage_api_key_from_vault(database_url)

    return Config(
        database_url=database_url,
        voyage_api_key=voyage_api_key,
        batch_size=int(os.environ.get("BATCH_SIZE", "128")),
    )
