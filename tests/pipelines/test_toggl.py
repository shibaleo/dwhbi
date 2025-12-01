"""Toggl pipeline テスト"""

import base64
import json
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from pipelines.services.toggl import (
    DbEntry,
    SyncResult,
    TogglTimeEntry,
    fetch_entries_by_range,
    get_auth_headers,
    sync_toggl,
    to_db_entry,
    upsert_entries,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_credentials():
    """認証情報のモック"""
    return {
        "credentials": {
            "api_token": "test_token_12345",
            "workspace_id": "123456"
        },
        "expires_at": None
    }


@pytest.fixture
def sample_time_entry() -> TogglTimeEntry:
    """サンプル時間エントリー"""
    return TogglTimeEntry(
        id=1234567890,
        workspace_id=123456,
        project_id=999,
        task_id=None,
        user_id=777,
        description="Test task",
        start="2024-01-15T10:00:00Z",
        stop="2024-01-15T11:30:00Z",
        duration=5400,  # 90分 = 5400秒
        billable=True,
        tags=["development", "backend"],
        at="2024-01-15T11:30:05Z"
    )


@pytest.fixture
def sample_running_entry() -> TogglTimeEntry:
    """実行中エントリー（duration < 0）"""
    return TogglTimeEntry(
        id=9999999999,
        workspace_id=123456,
        project_id=None,
        task_id=None,
        user_id=777,
        description="Running task",
        start="2024-01-15T14:00:00Z",
        stop=None,
        duration=-1705324800,  # 負の値 = 実行中
        billable=False,
        tags=[],
        at="2024-01-15T14:00:00Z"
    )


# =============================================================================
# Unit Tests: Authentication
# =============================================================================


@pytest.mark.asyncio
async def test_get_auth_headers_success(mock_credentials):
    """認証ヘッダー生成（正常系）"""
    with patch("pipelines.services.toggl.get_credentials", return_value=mock_credentials):
        headers = await get_auth_headers()

        assert "Authorization" in headers
        assert headers["Content-Type"] == "application/json"

        # Basic認証形式を検証
        auth_value = headers["Authorization"]
        assert auth_value.startswith("Basic ")

        # デコードして検証
        encoded = auth_value.split(" ")[1]
        decoded = base64.b64decode(encoded).decode()
        assert decoded == "test_token_12345:api_token"


@pytest.mark.asyncio
async def test_get_auth_headers_missing_token():
    """認証ヘッダー生成（api_token欠損）"""
    bad_credentials = {"credentials": {}, "expires_at": None}

    with patch("pipelines.services.toggl.get_credentials", return_value=bad_credentials):
        with pytest.raises(ValueError, match="missing api_token"):
            await get_auth_headers()


# =============================================================================
# Unit Tests: API Client
# =============================================================================


@pytest.mark.asyncio
async def test_fetch_entries_by_range_success(mock_credentials, sample_time_entry):
    """API呼び出し（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = [sample_time_entry]
    mock_response.raise_for_status = MagicMock()

    with patch("pipelines.services.toggl.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=mock_response) as mock_get:
            entries = await fetch_entries_by_range("2024-01-01", "2024-01-31")

            assert len(entries) == 1
            assert entries[0]["id"] == 1234567890
            assert entries[0]["description"] == "Test task"

            # API呼び出しパラメータを検証
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args.kwargs["params"] == {
                "start_date": "2024-01-01",
                "end_date": "2024-01-31"
            }


@pytest.mark.asyncio
async def test_fetch_entries_by_range_500_retry(mock_credentials):
    """API呼び出し（500エラー → リトライ → 成功）"""
    # 1回目: 500エラー、2回目: 成功
    error_response = MagicMock()
    error_response.status_code = 500
    error_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Server Error", request=MagicMock(), response=error_response
    )

    success_response = MagicMock()
    success_response.json.return_value = []
    success_response.raise_for_status = MagicMock()

    with patch("pipelines.services.toggl.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", side_effect=[error_response, success_response]):
            entries = await fetch_entries_by_range("2024-01-01", "2024-01-31", max_retries=2)
            assert entries == []


@pytest.mark.asyncio
async def test_fetch_entries_by_range_400_no_retry(mock_credentials):
    """API呼び出し（400エラー → リトライせず即座にraise）"""
    error_response = MagicMock()
    error_response.status_code = 400
    error_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Bad Request", request=MagicMock(), response=error_response
    )

    with patch("pipelines.services.toggl.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=error_response):
            with pytest.raises(httpx.HTTPStatusError):
                await fetch_entries_by_range("2024-01-01", "2024-01-31")


# =============================================================================
# Unit Tests: DB Transformation
# =============================================================================


def test_to_db_entry(sample_time_entry):
    """API型 → DB型変換"""
    db_entry = to_db_entry(sample_time_entry)

    assert db_entry["id"] == 1234567890
    assert db_entry["workspace_id"] == 123456
    assert db_entry["project_id"] == 999
    assert db_entry["description"] == "Test task"
    assert db_entry["start"] == "2024-01-15T10:00:00Z"
    assert db_entry["end"] == "2024-01-15T11:30:00Z"
    assert db_entry["duration_ms"] == 5400 * 1000  # 秒 → ミリ秒
    assert db_entry["is_billable"] is True
    assert db_entry["tags"] == ["development", "backend"]
    assert db_entry["billable_amount"] is None  # Reports APIのみ
    assert db_entry["currency"] is None


def test_to_db_entry_minimal(sample_time_entry):
    """API型 → DB型変換（最小フィールド）"""
    minimal_entry = TogglTimeEntry(
        id=123,
        workspace_id=456,
        project_id=None,
        task_id=None,
        user_id=789,
        description=None,
        start="2024-01-15T10:00:00Z",
        stop=None,  # stopがNone
        duration=3600,
        billable=False,
        tags=[],
        at="2024-01-15T11:00:00Z"
    )

    db_entry = to_db_entry(minimal_entry)

    assert db_entry["project_id"] is None
    assert db_entry["description"] is None
    assert db_entry["end"] == "2024-01-15T10:00:00Z"  # stopがNoneならstartを使用
    assert db_entry["tags"] == []


# =============================================================================
# Unit Tests: DB Write
# =============================================================================


@pytest.mark.asyncio
async def test_upsert_entries_success(sample_time_entry):
    """DB書き込み（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": 1234567890}]

    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result

    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table

    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema

    with patch("pipelines.services.toggl.get_supabase_client", return_value=mock_supabase):
        count = await upsert_entries([sample_time_entry])

        assert count == 1
        mock_schema.table.assert_called_once_with("toggl_entries")
        mock_table.upsert.assert_called_once()


@pytest.mark.asyncio
async def test_upsert_entries_filters_running():
    """DB書き込み（実行中エントリーを除外）"""
    running_entry = TogglTimeEntry(
        id=999,
        workspace_id=123,
        project_id=None,
        task_id=None,
        user_id=777,
        description="Running",
        start="2024-01-15T14:00:00Z",
        stop=None,
        duration=-1000,  # 負の値 = 実行中
        billable=False,
        tags=[],
        at="2024-01-15T14:00:00Z"
    )

    mock_supabase = MagicMock()
    with patch("pipelines.services.toggl.get_supabase_client", return_value=mock_supabase):
        count = await upsert_entries([running_entry])

        # 実行中エントリーは保存されない
        assert count == 0


@pytest.mark.asyncio
async def test_upsert_entries_empty():
    """DB書き込み（空リスト）"""
    mock_supabase = MagicMock()
    with patch("pipelines.services.toggl.get_supabase_client", return_value=mock_supabase):
        count = await upsert_entries([])
        assert count == 0


# =============================================================================
# Integration Tests: sync_toggl
# =============================================================================


@pytest.mark.asyncio
async def test_sync_toggl_success(mock_credentials, sample_time_entry):
    """sync_toggl 統合テスト（正常系）"""
    # API呼び出しをモック
    with patch("pipelines.services.toggl.get_credentials", return_value=mock_credentials):
        with patch(
            "pipelines.services.toggl.fetch_entries_by_range",
            return_value=[sample_time_entry]
        ):
            # DB書き込みをモック
            with patch("pipelines.services.toggl.upsert_entries", return_value=1) as mock_upsert:
                result = await sync_toggl(days=3)

                assert result["success"] is True
                assert result["entries"] == 1

                # upsert_entriesが呼ばれたことを確認
                mock_upsert.assert_called_once()
                call_args = mock_upsert.call_args[0][0]
                assert len(call_args) == 1
                assert call_args[0]["id"] == 1234567890


@pytest.mark.asyncio
async def test_sync_toggl_date_range(mock_credentials):
    """sync_toggl の日付範囲計算"""
    with patch("pipelines.services.toggl.get_credentials", return_value=mock_credentials):
        with patch(
            "pipelines.services.toggl.fetch_entries_by_range",
            return_value=[]
        ) as mock_fetch:
            with patch("pipelines.services.toggl.upsert_entries", return_value=0):
                await sync_toggl(days=7)

                # 日付範囲を検証
                call_args = mock_fetch.call_args[0]
                start_str, end_str = call_args[0], call_args[1]

                today = date.today()
                expected_start = (today - timedelta(days=6)).isoformat()
                expected_end = today.isoformat()

                assert start_str == expected_start
                assert end_str == expected_end
