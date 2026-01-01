"""Configuration for embedding module."""

import os
from dataclasses import dataclass


@dataclass
class Config:
    database_url: str
    voyage_api_key: str
    batch_size: int = 128
    max_tokens: int = 32000  # Voyage AI voyage-3-liteの制限


def load_config() -> Config:
    """環境変数から設定を読み込み"""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL is required")

    voyage_api_key = os.environ.get("VOYAGE_API_KEY")
    if not voyage_api_key:
        raise ValueError("VOYAGE_API_KEY is required")

    return Config(
        database_url=database_url,
        voyage_api_key=voyage_api_key,
        batch_size=int(os.environ.get("BATCH_SIZE", "128")),
    )
