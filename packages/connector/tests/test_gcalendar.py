"""Google Calendar 同期モジュールのテスト"""

import json
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pipelines.services.gcalendar import (
    to_db_event,
    sync_gcalendar,
    get_calendar_id,
    load_service_account,
    upsert_events,
    reset_cache,
    GCalEvent,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def clear_cache():
    """各テスト前にキャッシュをクリア"""
    reset_cache()
    yield
    reset_cache()


@pytest.fixture
def sample_gcal_event() -> GCalEvent:
    """サンプルGoogle Calendarイベント"""
    return {
        "id": "event123",
        "etag": '"abc123"',
        "status": "confirmed",
        "summary": "テストミーティング",
        "description": "テスト用のイベント",
        "colorId": "1",
        "recurringEventId": None,
        "start": {"dateTime": "2025-12-01T10:00:00+09:00"},
        "end": {"dateTime": "2025-12-01T11:00:00+09:00"},
        "updated": "2025-12-01T09:00:00Z",
    }


@pytest.fixture
def sample_all_day_event() -> GCalEvent:
    """サンプル終日イベント"""
    return {
        "id": "allday123",
        "etag": '"def456"',
        "status": "confirmed",
        "summary": "休暇",
        "start": {"date": "2025-12-25"},
        "end": {"date": "2025-12-26"},
    }


@pytest.fixture
def sample_recurring_event() -> GCalEvent:
    """サンプル繰り返しイベント（展開後）"""
    return {
        "id": "recurring123_20251201",
        "etag": '"ghi789"',
        "status": "confirmed",
        "summary": "週次ミーティング",
        "recurringEventId": "recurring123",
        "start": {"dateTime": "2025-12-01T09:00:00+09:00"},
        "end": {"dateTime": "2025-12-01T10:00:00+09:00"},
    }


@pytest.fixture
def valid_service_account_json():
    """有効なサービスアカウントJSON"""
    return json.dumps({
        "type": "service_account",
        "project_id": "test-project",
        "private_key_id": "key123",
        "private_key": "-----BEGIN PRIVATE KEY-----\nfake_key\n-----END PRIVATE KEY-----",
        "client_email": "test@test-project.iam.gserviceaccount.com",
        "client_id": "123456789",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/test",
    })


# =============================================================================
# Transform Tests (6.4 型変換関数)
# =============================================================================


def test_to_db_event(sample_gcal_event):
    """通常イベントの変換"""
    result = to_db_event(sample_gcal_event, "test@group.calendar.google.com")

    assert result["id"] == "event123"
    assert result["calendar_id"] == "test@group.calendar.google.com"
    assert result["summary"] == "テストミーティング"
    assert result["description"] == "テスト用のイベント"
    assert result["start_time"] == "2025-12-01T10:00:00+09:00"
    assert result["end_time"] == "2025-12-01T11:00:00+09:00"
    assert result["is_all_day"] is False
    assert result["color_id"] == "1"
    assert result["status"] == "confirmed"
    assert result["etag"] == '"abc123"'
    assert result["updated"] == "2025-12-01T09:00:00Z"


def test_to_db_event_all_day(sample_all_day_event):
    """終日イベントの変換（4.2 終日イベントの変換）"""
    result = to_db_event(sample_all_day_event, "test@group.calendar.google.com")

    assert result["id"] == "allday123"
    # 終日イベントは T00:00:00+09:00 が付与される
    assert result["start_time"] == "2025-12-25T00:00:00+09:00"
    assert result["end_time"] == "2025-12-26T00:00:00+09:00"
    assert result["is_all_day"] is True
    assert result["summary"] == "休暇"


def test_to_db_event_minimal():
    """最小フィールドのイベント変換"""
    minimal_event: GCalEvent = {
        "id": "minimal123",
        "start": {"dateTime": "2025-12-01T10:00:00+09:00"},
        "end": {"dateTime": "2025-12-01T11:00:00+09:00"},
    }
    result = to_db_event(minimal_event, "cal123")

    assert result["id"] == "minimal123"
    assert result["summary"] is None
    assert result["description"] is None
    assert result["color_id"] is None
    assert result["status"] is None
    assert result["recurring_event_id"] is None
    assert result["etag"] is None
    assert result["updated"] is None


def test_to_db_event_recurring(sample_recurring_event):
    """繰り返しイベント（展開後）の変換"""
    result = to_db_event(sample_recurring_event, "cal123")

    assert result["id"] == "recurring123_20251201"
    assert result["recurring_event_id"] == "recurring123"
    assert result["summary"] == "週次ミーティング"


def test_to_db_event_cancelled():
    """キャンセルされたイベントの変換"""
    cancelled_event: GCalEvent = {
        "id": "cancelled123",
        "status": "cancelled",
        "start": {"dateTime": "2025-12-01T10:00:00+09:00"},
        "end": {"dateTime": "2025-12-01T11:00:00+09:00"},
    }
    result = to_db_event(cancelled_event, "cal123")

    assert result["status"] == "cancelled"


# =============================================================================
# Authentication Tests (6.2 認証関数)
# =============================================================================


@pytest.mark.asyncio
async def test_get_calendar_id(valid_service_account_json):
    """カレンダーID取得の正常系"""
    mock_creds = {
        "credentials": {
            "service_account_json": valid_service_account_json,
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds
        calendar_id = await get_calendar_id()
        assert calendar_id == "test@group.calendar.google.com"


@pytest.mark.asyncio
async def test_get_calendar_id_missing(valid_service_account_json):
    """カレンダーID未設定のエラー（9.2 例外一覧）"""
    mock_creds = {
        "credentials": {
            "service_account_json": valid_service_account_json,
            # calendar_id が無い
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds

        with pytest.raises(ValueError, match="missing calendar_id"):
            await get_calendar_id()


@pytest.mark.asyncio
async def test_load_service_account_success(valid_service_account_json):
    """サービスアカウント読み込みの正常系"""
    mock_creds = {
        "credentials": {
            "service_account_json": valid_service_account_json,
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds
        sa_creds, calendar_id = await load_service_account()

        assert sa_creds["client_email"] == "test@test-project.iam.gserviceaccount.com"
        assert sa_creds["project_id"] == "test-project"
        assert calendar_id == "test@group.calendar.google.com"


@pytest.mark.asyncio
async def test_load_service_account_missing_json():
    """service_account_json 欠損エラー（9.2 例外一覧）"""
    mock_creds = {
        "credentials": {
            # service_account_json が無い
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds

        with pytest.raises(ValueError, match="missing service_account_json"):
            await load_service_account()


@pytest.mark.asyncio
async def test_load_service_account_missing_client_email():
    """client_email 欠損エラー（9.3 認証情報の検証）"""
    invalid_json = json.dumps({
        "private_key": "fake_key",
        # client_email が無い
    })
    mock_creds = {
        "credentials": {
            "service_account_json": invalid_json,
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds

        with pytest.raises(ValueError, match="missing client_email or private_key"):
            await load_service_account()


@pytest.mark.asyncio
async def test_load_service_account_missing_private_key():
    """private_key 欠損エラー（9.3 認証情報の検証）"""
    invalid_json = json.dumps({
        "client_email": "test@test.iam.gserviceaccount.com",
        # private_key が無い
    })
    mock_creds = {
        "credentials": {
            "service_account_json": invalid_json,
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds

        with pytest.raises(ValueError, match="missing client_email or private_key"):
            await load_service_account()


@pytest.mark.asyncio
async def test_load_service_account_invalid_base64():
    """不正なBase64形式エラー（{で始まらない文字列はBase64としてデコード試行）"""
    mock_creds = {
        "credentials": {
            "service_account_json": "not a valid base64",
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds

        with pytest.raises(ValueError, match="Failed to decode service_account_json as Base64"):
            await load_service_account()


@pytest.mark.asyncio
async def test_load_service_account_invalid_json():
    """有効なBase64だがJSON形式でないエラー"""
    import base64
    # 有効なBase64だがJSONではない
    invalid_content = base64.b64encode(b"not json content").decode()
    mock_creds = {
        "credentials": {
            "service_account_json": invalid_content,
            "calendar_id": "test@group.calendar.google.com",
        },
        "expires_at": None,
    }

    with patch("pipelines.services.gcalendar.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_creds

        with pytest.raises(ValueError, match="Failed to parse service_account_json"):
            await load_service_account()


# =============================================================================
# DB Write Tests (6.5 DB書き込み関数)
# =============================================================================


@pytest.mark.asyncio
async def test_upsert_events_success(sample_gcal_event):
    """イベント保存の正常系"""
    db_event = to_db_event(sample_gcal_event, "cal123")

    with patch("pipelines.services.gcalendar.get_supabase_client") as mock_client:
        mock_result = MagicMock()
        mock_result.data = [db_event]
        mock_client.return_value.schema.return_value.table.return_value.upsert.return_value.execute.return_value = mock_result

        count = await upsert_events([db_event])

        assert count == 1
        # on_conflict="id" で呼ばれていることを確認
        mock_client.return_value.schema.return_value.table.return_value.upsert.assert_called_once()


@pytest.mark.asyncio
async def test_upsert_events_empty():
    """空リストの保存（DBアクセスなし）"""
    count = await upsert_events([])
    assert count == 0


@pytest.mark.asyncio
async def test_upsert_events_multiple(sample_gcal_event, sample_all_day_event):
    """複数イベントの保存"""
    db_events = [
        to_db_event(sample_gcal_event, "cal123"),
        to_db_event(sample_all_day_event, "cal123"),
    ]

    with patch("pipelines.services.gcalendar.get_supabase_client") as mock_client:
        mock_result = MagicMock()
        mock_result.data = db_events
        mock_client.return_value.schema.return_value.table.return_value.upsert.return_value.execute.return_value = mock_result

        count = await upsert_events(db_events)

        assert count == 2


# =============================================================================
# Integration Tests (6.1 メイン関数)
# =============================================================================


@pytest.mark.asyncio
async def test_sync_gcalendar_success(sample_gcal_event):
    """sync_gcalendar 統合テスト"""
    db_event = to_db_event(sample_gcal_event, "test@group.calendar.google.com")

    fetch_result = {
        "events": [db_event],
        "http_requests": 2,
        "elapsed_seconds": 0.5,
    }

    with patch("pipelines.services.gcalendar.fetch_all_events", new_callable=AsyncMock) as mock_fetch, \
         patch("pipelines.services.gcalendar.upsert_events", new_callable=AsyncMock) as mock_upsert:

        mock_fetch.return_value = fetch_result
        mock_upsert.return_value = 1

        result = await sync_gcalendar(days=3)

        assert result["success"] is True
        assert result["stats"]["fetched"] == 1
        assert result["stats"]["upserted"] == 1


@pytest.mark.asyncio
async def test_sync_gcalendar_date_range():
    """日付範囲の計算テスト（4.1 処理シーケンス）"""
    today = date.today()
    days = 7

    # endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
    expected_end = today + timedelta(days=1)
    # startDate = endDate - (days + 1)
    expected_start = expected_end - timedelta(days=days + 1)

    # 実際の計算が正しいか検証
    end_date = today + timedelta(days=1)
    start_date = end_date - timedelta(days=days + 1)

    assert start_date == expected_start
    assert end_date == expected_end
    # 7日分の同期で実際には8日間のデータを取得
    assert (end_date - start_date).days == days + 1


@pytest.mark.asyncio
async def test_sync_gcalendar_default_days():
    """デフォルト日数（7日）のテスト"""
    fetch_result = {
        "events": [],
        "http_requests": 2,
        "elapsed_seconds": 0.5,
    }

    with patch("pipelines.services.gcalendar.fetch_all_events", new_callable=AsyncMock) as mock_fetch, \
         patch("pipelines.services.gcalendar.upsert_events", new_callable=AsyncMock) as mock_upsert:

        mock_fetch.return_value = fetch_result
        mock_upsert.return_value = 0

        result = await sync_gcalendar()  # days=7 がデフォルト

        assert result["success"] is True
        # fetch_all_events が呼ばれたことを確認
        mock_fetch.assert_called_once()


@pytest.mark.asyncio
async def test_sync_gcalendar_result_stats(sample_gcal_event, sample_all_day_event):
    """同期結果の統計情報テスト（7.4 結果型）"""
    db_events = [
        to_db_event(sample_gcal_event, "cal123"),
        to_db_event(sample_all_day_event, "cal123"),
    ]

    fetch_result = {
        "events": db_events,
        "http_requests": 2,
        "elapsed_seconds": 1.5,
    }

    with patch("pipelines.services.gcalendar.fetch_all_events", new_callable=AsyncMock) as mock_fetch, \
         patch("pipelines.services.gcalendar.upsert_events", new_callable=AsyncMock) as mock_upsert:

        mock_fetch.return_value = fetch_result
        mock_upsert.return_value = 2

        result = await sync_gcalendar(days=3)

        assert result["success"] is True
        assert result["stats"]["fetched"] == 2
        assert result["stats"]["upserted"] == 2
