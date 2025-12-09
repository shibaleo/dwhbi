"""Integration test fixtures and configuration."""

import os

import pytest


@pytest.fixture(scope="session")
def db_connection_string() -> str:
    """Return database connection string."""
    return os.environ.get("DIRECT_DATABASE_URL", "postgresql://localhost:5432/test")
