"""Supabase データベース接続"""

import os
from typing import Any

from supabase import Client, create_client


_supabase_client: Client | None = None


def get_supabase_client() -> Client:
    """Supabaseクライアントを取得（シングルトン）

    Returns:
        Supabase Client

    Raises:
        ValueError: SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY 未設定
    """
    global _supabase_client

    if _supabase_client is not None:
        return _supabase_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    _supabase_client = create_client(url, key)
    return _supabase_client


def reset_client() -> None:
    """クライアントをリセット（テスト用）"""
    global _supabase_client
    _supabase_client = None
