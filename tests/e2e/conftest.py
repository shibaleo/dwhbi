"""E2E test fixtures and configuration."""

import os

import pytest
from supabase import Client, create_client


@pytest.fixture(scope="session")
def supabase_client() -> Client:
    """Create a Supabase client for E2E tests."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        pytest.skip("Supabase credentials not configured")

    return create_client(url, key)


@pytest.fixture(scope="session")
def test_date() -> str:
    """Return a test date for E2E tests."""
    return "2025-01-01"
