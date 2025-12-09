"""Integration tests for database connectivity."""

import pytest


@pytest.mark.integration
class TestDatabaseConnectivity:
    """Test database connectivity across projects."""

    def test_can_connect_to_database(self, db_connection_string: str) -> None:
        """Test that we can connect to the database."""
        import psycopg2

        try:
            conn = psycopg2.connect(db_connection_string)
            conn.close()
        except Exception as e:
            pytest.fail(f"Failed to connect to database: {e}")

    def test_raw_schema_exists(self, db_connection_string: str) -> None:
        """Test that raw schema exists."""
        import psycopg2

        conn = psycopg2.connect(db_connection_string)
        cur = conn.cursor()
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name = 'raw'
        """)
        result = cur.fetchone()
        conn.close()

        assert result is not None, "raw schema does not exist"

    def test_staging_schema_exists(self, db_connection_string: str) -> None:
        """Test that staging schema exists."""
        import psycopg2

        conn = psycopg2.connect(db_connection_string)
        cur = conn.cursor()
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name = 'staging'
        """)
        result = cur.fetchone()
        conn.close()

        assert result is not None, "staging schema does not exist"
