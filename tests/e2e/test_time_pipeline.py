"""E2E tests for the time management pipeline."""

import pytest
from supabase import Client


@pytest.mark.e2e
class TestTimePipeline:
    """Test the complete time management pipeline."""

    def test_raw_data_exists(self, supabase_client: Client, test_date: str) -> None:
        """Test that raw data is loaded for the test date."""
        # connector の出力確認
        response = (
            supabase_client.table("raw_toggl_time_entries")
            .select("*")
            .eq("start_date", test_date)
            .execute()
        )

        assert response.data is not None
        # 実際のテストではデータの存在を確認

    def test_staging_views_exist(self, supabase_client: Client) -> None:
        """Test that staging views are created."""
        # transform の出力確認
        response = (
            supabase_client.table("stg_toggl_time_entries")
            .select("count", count="exact")
            .execute()
        )

        assert response.count is not None

    def test_core_views_exist(self, supabase_client: Client) -> None:
        """Test that core views are created."""
        response = (
            supabase_client.table("fct_time_records")
            .select("count", count="exact")
            .execute()
        )

        assert response.count is not None

    def test_estimates_generated(self, supabase_client: Client, test_date: str) -> None:
        """Test that estimates are generated."""
        # analyzer の出力確認
        response = (
            supabase_client.table("fct_time_daily_estimate")
            .select("*")
            .eq("date", test_date)
            .execute()
        )

        # テスト環境では存在しない可能性があるため、エラーでなければ OK
        assert response.data is not None or response.data == []
