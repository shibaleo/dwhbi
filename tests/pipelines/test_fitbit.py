"""Fitbit pipeline テスト"""

import httpx
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

from pipelines.services.fitbit import (
    DbSleep,
    FitbitApiSleepLog,
    OAuth2Credentials,
    RateLimiter,
    SyncResult,
    TokenResponse,
    convert_jst_to_utc,
    fetch_activity_data,
    fetch_heart_rate_data,
    fetch_hrv_data,
    fetch_sleep_data,
    fetch_spo2_data,
    format_fitbit_date,
    generate_periods,
    get_access_token,
    refresh_token_from_api,
    sync_fitbit,
    to_db_activity_daily,
    to_db_heart_rate_daily,
    to_db_hrv_daily,
    to_db_sleep,
    to_db_spo2_daily,
    upsert_activity_daily,
    upsert_heart_rate_daily,
    upsert_hrv_daily,
    upsert_sleep,
    upsert_spo2_daily,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_oauth_credentials():
    """OAuth 2.0認証情報のモック"""
    return {
        "credentials": {
            "client_id": "ABC123",
            "client_secret": "secret456",
            "access_token": "access_xyz",
            "refresh_token": "refresh_abc",
            "scope": "sleep heartrate activity",
            "user_id": "USER123",
        },
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=8),
    }


@pytest.fixture
def mock_token_response() -> TokenResponse:
    """トークンリフレッシュレスポンスのモック"""
    return {
        "access_token": "new_access_token",
        "refresh_token": "new_refresh_token",
        "expires_in": 28800,  # 8時間
        "token_type": "Bearer",
        "scope": "sleep heartrate activity",
        "user_id": "USER123",
    }


@pytest.fixture
def sample_sleep_log() -> FitbitApiSleepLog:
    """サンプル睡眠ログ"""
    return {
        "logId": 12345678901,
        "dateOfSleep": "2025-11-30",
        "startTime": "2025-11-29T23:30:00.000",  # JST（タイムゾーン情報なし）
        "endTime": "2025-11-30T07:15:00.000",  # JST
        "duration": 27900000,  # 7時間45分 = 27900000ミリ秒
        "efficiency": 92,
        "isMainSleep": True,
        "minutesAsleep": 435,  # 7時間15分
        "minutesAwake": 30,
        "timeInBed": 465,  # 7時間45分
        "type": "stages",
        "levels": {
            "summary": {
                "deep": {"count": 3, "minutes": 88},
                "light": {"count": 29, "minutes": 211},
                "rem": {"count": 6, "minutes": 89},
                "wake": {"count": 28, "minutes": 47},
            }
        },
    }


@pytest.fixture
def sample_heart_rate_response():
    """サンプル心拍数APIレスポンス"""
    return {
        "activities-heart": [
            {
                "dateTime": "2025-11-30",
                "value": {
                    "restingHeartRate": 58,
                    "heartRateZones": [
                        {"name": "Out of Range", "min": 30, "max": 85, "minutes": 1200},
                        {"name": "Fat Burn", "min": 85, "max": 119, "minutes": 180},
                        {"name": "Cardio", "min": 119, "max": 144, "minutes": 30},
                        {"name": "Peak", "min": 144, "max": 220, "minutes": 10},
                    ],
                },
            }
        ]
    }


@pytest.fixture
def sample_hrv_response():
    """サンプルHRV APIレスポンス"""
    return {
        "hrv": [
            {
                "dateTime": "2025-11-30",
                "value": {"dailyRmssd": 42.5, "deepRmssd": 55.3},
                "minutes": [
                    {"minute": "2025-11-30T01:30:00", "value": {"rmssd": 45.2}},
                    {"minute": "2025-11-30T02:00:00", "value": {"rmssd": 48.1}},
                ],
            }
        ]
    }


@pytest.fixture
def sample_activity_response():
    """サンプル活動APIレスポンス"""
    return {
        "summary": {
            "steps": 8234,
            "distances": [
                {"activity": "total", "distance": 6.12},
                {"activity": "tracker", "distance": 6.12},
            ],
            "floors": 12,
            "caloriesOut": 2345,
            "caloriesBMR": 1680,
            "activityCalories": 665,
            "sedentaryMinutes": 720,
            "lightlyActiveMinutes": 180,
            "fairlyActiveMinutes": 45,
            "veryActiveMinutes": 15,
        }
    }


@pytest.fixture
def sample_spo2_response():
    """サンプルSpO2 APIレスポンス"""
    return {"value": {"avg": 96.5, "min": 94.0, "max": 98.0}}


# =============================================================================
# Unit Tests: Helper Functions
# =============================================================================


def test_format_fitbit_date():
    """日付フォーマット変換"""
    dt = datetime(2025, 11, 30, 12, 34, 56, tzinfo=timezone.utc)
    result = format_fitbit_date(dt)
    assert result == "2025-11-30"


def test_convert_jst_to_utc():
    """JSTからUTCへのタイムゾーン変換"""
    jst_time = "2025-11-30T23:30:00.000"
    utc_time = convert_jst_to_utc(jst_time)

    # パース
    utc_dt = datetime.fromisoformat(utc_time)

    # UTCタイムゾーンであることを確認
    assert utc_dt.tzinfo == timezone.utc

    # JSTの23:30はUTCの14:30になる（-9時間）
    assert utc_dt.hour == 14
    assert utc_dt.minute == 30


def test_generate_periods_single_chunk():
    """期間分割（1チャンク内）"""
    start = datetime(2025, 11, 1, tzinfo=timezone.utc)
    end = datetime(2025, 11, 10, tzinfo=timezone.utc)
    max_days = 30

    periods = generate_periods(start, end, max_days)

    assert len(periods) == 1
    assert periods[0][0] == start
    assert periods[0][1] == end


def test_generate_periods_multiple_chunks():
    """期間分割（複数チャンク）"""
    start = datetime(2025, 9, 1, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)
    max_days = 30

    periods = generate_periods(start, end, max_days)

    # 91日間を30日ずつ分割すると4チャンク（30, 30, 30, 1）
    assert len(periods) == 4
    assert periods[0][0] == start


# =============================================================================
# Unit Tests: Rate Limiter
# =============================================================================


def test_rate_limiter_initialization():
    """レートリミッター初期化"""
    limiter = RateLimiter()
    assert limiter.request_count == 0
    assert limiter.get_remaining() == 150


def test_rate_limiter_track_request():
    """リクエストカウント"""
    limiter = RateLimiter()
    limiter.track_request()
    limiter.track_request()

    assert limiter.request_count == 2
    assert limiter.get_remaining() == 148


# =============================================================================
# Unit Tests: Authentication
# =============================================================================


@pytest.mark.asyncio
async def test_get_access_token_cached(mock_oauth_credentials):
    """アクセストークン取得（キャッシュ有効）"""
    with patch(
        "pipelines.services.fitbit.get_credentials", return_value=mock_oauth_credentials
    ):
        # 初回取得
        token1 = await get_access_token()
        assert token1 == "access_xyz"

        # 2回目（キャッシュから取得、APIコールなし）
        token2 = await get_access_token()
        assert token2 == "access_xyz"


@pytest.mark.asyncio
async def test_get_access_token_refresh_needed(
    mock_oauth_credentials, mock_token_response
):
    """アクセストークン取得（リフレッシュ必要）"""
    # 有効期限が30分後（閾値60分未満）
    mock_oauth_credentials["expires_at"] = datetime.now(timezone.utc) + timedelta(
        minutes=30
    )

    with patch(
        "pipelines.services.fitbit.get_credentials", return_value=mock_oauth_credentials
    ), patch(
        "pipelines.services.fitbit.refresh_token_from_api",
        return_value=mock_token_response,
    ) as mock_refresh, patch(
        "pipelines.services.fitbit.update_credentials"
    ) as mock_update:
        token = await get_access_token()

        # リフレッシュAPI呼び出しを確認
        mock_refresh.assert_called_once()
        mock_update.assert_called_once()
        assert token == "new_access_token"


@pytest.mark.asyncio
async def test_refresh_token_from_api_success(mock_token_response):
    """トークンリフレッシュAPI（正常系）"""
    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = mock_token_response

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_response
        )

        result = await refresh_token_from_api(
            "client_id", "client_secret", "refresh_token"
        )

        assert result["access_token"] == "new_access_token"
        assert result["expires_in"] == 28800


@pytest.mark.asyncio
async def test_refresh_token_from_api_error():
    """トークンリフレッシュAPI（エラー）"""
    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 401
    mock_response.text = "Invalid refresh token"

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_response
        )

        with pytest.raises(httpx.HTTPStatusError):
            await refresh_token_from_api("client_id", "client_secret", "bad_token")


# =============================================================================
# Unit Tests: Data Transformation
# =============================================================================


def test_to_db_sleep(sample_sleep_log):
    """睡眠データ変換"""
    result = to_db_sleep([sample_sleep_log])

    assert len(result) == 1
    db_sleep = result[0]

    assert db_sleep["date"] == "2025-11-30"
    assert db_sleep["log_id"] == 12345678901
    assert db_sleep["duration_ms"] == 27900000
    assert db_sleep["efficiency"] == 92
    assert db_sleep["is_main_sleep"] is True
    assert db_sleep["minutes_asleep"] == 435
    assert db_sleep["sleep_type"] == "stages"

    # タイムゾーン変換確認（JSTからUTC）
    start_time = datetime.fromisoformat(db_sleep["start_time"])
    assert start_time.tzinfo == timezone.utc
    assert start_time.hour == 14  # JST 23:30 → UTC 14:30


def test_to_db_heart_rate_daily(sample_heart_rate_response):
    """心拍数データ変換"""
    result = to_db_heart_rate_daily(sample_heart_rate_response["activities-heart"])

    assert len(result) == 1
    db_hr = result[0]

    assert db_hr["date"] == "2025-11-30"
    assert db_hr["resting_heart_rate"] == 58
    assert len(db_hr["heart_rate_zones"]) == 4


def test_to_db_hrv_daily(sample_hrv_response):
    """HRVデータ変換"""
    result = to_db_hrv_daily(sample_hrv_response["hrv"])

    assert len(result) == 1
    db_hrv = result[0]

    assert db_hrv["date"] == "2025-11-30"
    assert db_hrv["daily_rmssd"] == 42.5
    assert db_hrv["deep_rmssd"] == 55.3
    assert len(db_hrv["intraday"]) == 2


def test_to_db_activity_daily(sample_activity_response):
    """活動データ変換"""
    activity_map = {"2025-11-30": sample_activity_response["summary"]}
    result = to_db_activity_daily(activity_map)

    assert len(result) == 1
    db_activity = result[0]

    assert db_activity["date"] == "2025-11-30"
    assert db_activity["steps"] == 8234
    assert db_activity["distance_km"] == 6.12
    assert db_activity["floors"] == 12
    assert db_activity["calories_total"] == 2345
    assert db_activity["sedentary_minutes"] == 720


def test_to_db_spo2_daily(sample_spo2_response):
    """SpO2データ変換"""
    spo2_map = {"2025-11-30": sample_spo2_response}
    result = to_db_spo2_daily(spo2_map)

    assert len(result) == 1
    db_spo2 = result[0]

    assert db_spo2["date"] == "2025-11-30"
    assert db_spo2["avg_spo2"] == 96.5
    assert db_spo2["min_spo2"] == 94.0
    assert db_spo2["max_spo2"] == 98.0


# =============================================================================
# Unit Tests: DB Operations
# =============================================================================


@pytest.mark.asyncio
async def test_upsert_sleep_empty():
    """睡眠データupsert（空リスト）"""
    result = await upsert_sleep([])
    assert result == 0


@pytest.mark.asyncio
async def test_upsert_sleep_success(sample_sleep_log):
    """睡眠データupsert（正常系）"""
    mock_response = MagicMock()
    mock_response.error = None

    with patch("pipelines.services.fitbit.get_supabase_client") as mock_supabase:
        mock_table = MagicMock()
        mock_table.upsert.return_value.execute.return_value = mock_response
        mock_supabase.return_value.schema.return_value.table.return_value = mock_table

        result = await upsert_sleep([sample_sleep_log])

        assert result == 1
        mock_table.upsert.assert_called_once()


@pytest.mark.asyncio
async def test_upsert_heart_rate_daily_success(sample_heart_rate_response):
    """心拍数データupsert（正常系）"""
    mock_response = MagicMock()
    mock_response.error = None

    with patch("pipelines.services.fitbit.get_supabase_client") as mock_supabase:
        mock_table = MagicMock()
        mock_table.upsert.return_value.execute.return_value = mock_response
        mock_supabase.return_value.schema.return_value.table.return_value = mock_table

        result = await upsert_heart_rate_daily(
            sample_heart_rate_response["activities-heart"]
        )

        assert result == 1
        mock_table.upsert.assert_called_once()


# =============================================================================
# Integration Tests: API Fetch
# =============================================================================


@pytest.mark.asyncio
async def test_fetch_sleep_data_success(sample_sleep_log):
    """睡眠データ取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = {"sleep": [sample_sleep_log]}

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 28, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_sleep_data(mock_client, "test_token", start, end)

    assert len(result) == 1
    assert result[0]["logId"] == 12345678901


@pytest.mark.asyncio
async def test_fetch_heart_rate_data_success(sample_heart_rate_response):
    """心拍数データ取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = sample_heart_rate_response

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 28, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_heart_rate_data(mock_client, "test_token", start, end)

    assert len(result) == 1
    assert result[0]["value"]["restingHeartRate"] == 58


@pytest.mark.asyncio
async def test_fetch_activity_data_success(sample_activity_response):
    """活動データ取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = sample_activity_response

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 30, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_activity_data(mock_client, "test_token", start, end)

    assert len(result) == 1
    assert "2025-11-30" in result
    assert result["2025-11-30"]["steps"] == 8234


@pytest.mark.asyncio
async def test_fetch_spo2_data_success(sample_spo2_response):
    """SpO2データ取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = sample_spo2_response

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 30, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_spo2_data(mock_client, "test_token", start, end)

    assert len(result) == 1
    assert "2025-11-30" in result
    assert result["2025-11-30"]["value"]["avg"] == 96.5


# =============================================================================
# Integration Tests: Full Sync
# =============================================================================


@pytest.mark.asyncio
async def test_sync_fitbit_success(
    mock_oauth_credentials,
    sample_sleep_log,
    sample_heart_rate_response,
    sample_hrv_response,
    sample_activity_response,
    sample_spo2_response,
):
    """全データ同期（正常系）"""
    # Mock認証
    with patch(
        "pipelines.services.fitbit.get_credentials", return_value=mock_oauth_credentials
    ):
        # Mock API responses
        mock_sleep_response = MagicMock()
        mock_sleep_response.json.return_value = {"sleep": [sample_sleep_log]}

        mock_hr_response = MagicMock()
        mock_hr_response.json.return_value = sample_heart_rate_response

        mock_hrv_response = MagicMock()
        mock_hrv_response.json.return_value = sample_hrv_response

        mock_activity_response = MagicMock()
        mock_activity_response.json.return_value = sample_activity_response

        mock_spo2_response = MagicMock()
        mock_spo2_response.json.return_value = sample_spo2_response

        # Mock HTTP client
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = MagicMock()

            async def mock_get(url, **kwargs):
                if "/sleep/" in url:
                    return mock_sleep_response
                elif "/heart/" in url:
                    return mock_hr_response
                elif "/hrv/" in url:
                    return mock_hrv_response
                elif "/activities/" in url:
                    return mock_activity_response
                elif "/spo2/" in url:
                    return mock_spo2_response
                return MagicMock()

            mock_client.get = mock_get
            mock_client_class.return_value.__aenter__.return_value = mock_client

            # Mock DB
            mock_db_response = MagicMock()
            mock_db_response.error = None

            with patch("pipelines.services.fitbit.get_supabase_client") as mock_supabase:
                mock_table = MagicMock()
                mock_table.upsert.return_value.execute.return_value = mock_db_response
                mock_supabase.return_value.schema.return_value.table.return_value = (
                    mock_table
                )

                # 同期実行
                result = await sync_fitbit(days=3)

                # 検証
                assert result["success"] is True
                assert result["stats"]["sleep"] >= 0
                assert result["stats"]["heart_rate"] >= 0
                assert result["stats"]["hrv"] >= 0
                assert result["stats"]["activity"] >= 0
                assert result["stats"]["spo2"] >= 0
