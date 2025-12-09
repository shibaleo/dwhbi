"""Tanita pipeline テスト"""

import httpx
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

from pipelines.services.tanita import (
    BLOOD_PRESSURE_TAG_MAP,
    BODY_COMPOSITION_TAG_MAP,
    DbBloodPressure,
    DbBodyComposition,
    OAuth2Credentials,
    SyncResult,
    TanitaApiMeasurement,
    TokenResponse,
    fetch_blood_pressure,
    fetch_body_composition,
    format_tanita_date,
    generate_periods,
    get_access_token,
    parse_tanita_date,
    refresh_token_from_api,
    sync_tanita,
    to_db_blood_pressure,
    to_db_body_composition,
    upsert_blood_pressure,
    upsert_body_composition,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_oauth_credentials():
    """OAuth 2.0認証情報のモック"""
    return {
        "credentials": {
            "client_id": "tanita_client_123",
            "client_secret": "tanita_secret_456",
            "access_token": "tanita_access_xyz",
            "refresh_token": "tanita_refresh_abc",
            "scope": "innerscan",
        },
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=3),
    }


@pytest.fixture
def mock_token_response() -> TokenResponse:
    """トークンリフレッシュレスポンスのモック"""
    return {
        "access_token": "new_tanita_access_token",
        "refresh_token": "new_tanita_refresh_token",
        "expires_in": 10800,  # 3時間
        "token_type": "Bearer",
    }


@pytest.fixture
def sample_measurements() -> list[TanitaApiMeasurement]:
    """サンプル測定データ

    API仕様: keydata = 測定値、tag = 測定部位
    """
    return [
        {
            "date": "202511301530",
            "keydata": "70.5",  # 体重
            "model": "01000117",  # RD-800
            "tag": "6021",
        },
        {
            "date": "202511301530",
            "keydata": "18.5",  # 体脂肪率
            "model": "01000117",
            "tag": "6022",
        },
    ]


@pytest.fixture
def sample_api_response():
    """サンプルAPIレスポンス

    API仕様: keydata = 測定値、tag = 測定部位
    """
    return {
        "status": "0",
        "data": [
            {
                "date": "202511301530",
                "keydata": "70.5",  # 体重
                "model": "01000117",
                "tag": "6021",
            },
            {
                "date": "202511301530",
                "keydata": "18.5",  # 体脂肪率
                "model": "01000117",
                "tag": "6022",
            },
        ],
    }


@pytest.fixture
def sample_blood_pressure_measurements() -> list[TanitaApiMeasurement]:
    """サンプル血圧測定データ

    API仕様: keydata = 測定値、tag = 測定部位
    """
    return [
        {
            "date": "202511301530",
            "keydata": "120",  # 最高血圧
            "model": "01000078",  # BP-900
            "tag": "622E",
        },
        {
            "date": "202511301530",
            "keydata": "80",  # 最低血圧
            "model": "01000078",
            "tag": "622F",
        },
        {
            "date": "202511301530",
            "keydata": "72",  # 脈拍
            "model": "01000078",
            "tag": "6230",
        },
    ]


@pytest.fixture
def sample_blood_pressure_api_response():
    """サンプル血圧APIレスポンス"""
    return {
        "status": "0",
        "data": [
            {
                "date": "202511301530",
                "keydata": "120",
                "model": "01000078",
                "tag": "622E",
            },
            {
                "date": "202511301530",
                "keydata": "80",
                "model": "01000078",
                "tag": "622F",
            },
            {
                "date": "202511301530",
                "keydata": "72",
                "model": "01000078",
                "tag": "6230",
            },
        ],
    }


# =============================================================================
# Unit Tests: Helper Functions
# =============================================================================


def test_format_tanita_date():
    """日付フォーマット変換（14桁: yyyyMMddHHmmss）"""
    dt = datetime(2025, 11, 30, 12, 34, 56, tzinfo=timezone.utc)
    result = format_tanita_date(dt)
    assert result == "20251130123456"


def test_parse_tanita_date():
    """Tanita日付からISO8601 UTCへの変換（12桁）"""
    tanita_date = "202511301530"
    utc_time = parse_tanita_date(tanita_date)

    # パース
    utc_dt = datetime.fromisoformat(utc_time)

    # UTCタイムゾーンであることを確認
    assert utc_dt.tzinfo == timezone.utc

    # JST 15:30 → UTC 06:30（-9時間）
    assert utc_dt.hour == 6
    assert utc_dt.minute == 30


def test_parse_tanita_date_14_digits():
    """Tanita日付からISO8601 UTCへの変換（14桁）"""
    tanita_date = "20251130153045"
    utc_time = parse_tanita_date(tanita_date)

    # パース
    utc_dt = datetime.fromisoformat(utc_time)

    # UTCタイムゾーンであることを確認
    assert utc_dt.tzinfo == timezone.utc

    # JST 15:30:45 → UTC 06:30:45（-9時間）
    assert utc_dt.hour == 6
    assert utc_dt.minute == 30
    assert utc_dt.second == 45


def test_parse_tanita_date_invalid():
    """Tanita日付パース（異常値）"""
    with pytest.raises(ValueError, match="Invalid date format"):
        parse_tanita_date("20251130")  # 8桁は無効


def test_generate_periods_single_chunk():
    """期間分割（1チャンク内）"""
    start = datetime(2025, 11, 1, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)
    max_days = 90

    periods = generate_periods(start, end, max_days)

    assert len(periods) == 1
    assert periods[0][0] == start
    assert periods[0][1] == end


def test_generate_periods_multiple_chunks():
    """期間分割（複数チャンク）"""
    start = datetime(2025, 5, 1, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)
    max_days = 90

    periods = generate_periods(start, end, max_days)

    # 214日間を90日ずつ分割すると3チャンク（90, 90, 34）
    assert len(periods) == 3
    assert periods[0][0] == start


# =============================================================================
# Unit Tests: Authentication
# =============================================================================


@pytest.mark.asyncio
async def test_get_access_token_cached(mock_oauth_credentials):
    """アクセストークン取得（キャッシュ有効）"""
    # グローバルキャッシュをクリア
    import pipelines.services.tanita as tanita_module

    tanita_module._auth_cache = None

    with patch(
        "pipelines.services.tanita.get_credentials",
        return_value=mock_oauth_credentials,
    ):
        # 初回取得
        token1 = await get_access_token()
        assert token1 == "tanita_access_xyz"

        # 2回目（キャッシュから取得、APIコールなし）
        token2 = await get_access_token()
        assert token2 == "tanita_access_xyz"


@pytest.mark.asyncio
async def test_get_access_token_refresh_needed(mock_token_response):
    """アクセストークン取得（リフレッシュ必要）"""
    # グローバルキャッシュをクリア
    import pipelines.services.tanita as tanita_module

    tanita_module._auth_cache = None

    # 有効期限が20分後（閾値30分未満）のcredentialsを作成
    credentials_with_short_expiry = {
        "credentials": {
            "client_id": "tanita_client_123",
            "client_secret": "tanita_secret_456",
            "access_token": "tanita_access_xyz",
            "refresh_token": "tanita_refresh_abc",
            "scope": "innerscan",
        },
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=20),
    }

    with patch(
        "pipelines.services.tanita.get_credentials",
        return_value=credentials_with_short_expiry,
    ), patch(
        "pipelines.services.tanita.refresh_token_from_api",
        return_value=mock_token_response,
    ) as mock_refresh, patch(
        "pipelines.services.tanita.update_credentials"
    ) as mock_update:
        token = await get_access_token()

        # リフレッシュAPI呼び出しを確認
        mock_refresh.assert_called_once()
        mock_update.assert_called_once()
        assert token == "new_tanita_access_token"


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

        assert result["access_token"] == "new_tanita_access_token"
        assert result["expires_in"] == 10800


@pytest.mark.asyncio
async def test_refresh_token_from_api_error():
    """トークンリフレッシュAPI（エラー）"""
    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 401
    mock_response.text = "Invalid refresh token"
    # raise_for_status()が実際に例外を投げるように設定
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "401 Unauthorized",
        request=MagicMock(),
        response=mock_response,
    )

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_response
        )

        with pytest.raises(httpx.HTTPStatusError):
            await refresh_token_from_api("client_id", "client_secret", "bad_token")


# =============================================================================
# Unit Tests: Data Transformation
# =============================================================================


def test_to_db_body_composition(sample_measurements):
    """測定データ変換"""
    result = to_db_body_composition(sample_measurements)

    assert len(result) == 1
    record = result[0]

    # 日時変換確認
    measured_at = datetime.fromisoformat(record["measured_at"])
    assert measured_at.tzinfo == timezone.utc
    assert measured_at.hour == 6  # JST 15:30 → UTC 06:30

    # フィールドマッピング確認（keydata = 測定値、DBカラム名に合わせる）
    assert record["weight"] == 70.5
    assert record["body_fat_percent"] == 18.5
    assert record["model"] == "01000117"


def test_to_db_body_composition_multiple_timestamps():
    """複数タイムスタンプの測定データ変換"""
    measurements = [
        {
            "date": "202511301530",
            "keydata": "70.5",  # 体重
            "model": "01000117",
            "tag": "6021",
        },
        {
            "date": "202511301530",
            "keydata": "18.5",  # 体脂肪率
            "model": "01000117",
            "tag": "6022",
        },
        {
            "date": "202511291030",  # 異なる日時
            "keydata": "71.0",  # 体重
            "model": "01000117",
            "tag": "6021",
        },
    ]

    result = to_db_body_composition(measurements)

    # 2つの異なるタイムスタンプなので2レコード
    assert len(result) == 2


def test_to_db_blood_pressure(sample_blood_pressure_measurements):
    """血圧データ変換"""
    result = to_db_blood_pressure(sample_blood_pressure_measurements)

    assert len(result) == 1
    record = result[0]

    # 日時変換確認
    measured_at = datetime.fromisoformat(record["measured_at"])
    assert measured_at.tzinfo == timezone.utc
    assert measured_at.hour == 6  # JST 15:30 → UTC 06:30

    # フィールドマッピング確認
    assert record["systolic"] == 120
    assert record["diastolic"] == 80
    assert record["pulse"] == 72
    assert record["model"] == "01000078"


def test_to_db_blood_pressure_multiple_timestamps():
    """複数タイムスタンプの血圧データ変換"""
    measurements = [
        {
            "date": "202511301530",
            "keydata": "120",  # 最高血圧
            "model": "01000078",
            "tag": "622E",
        },
        {
            "date": "202511301530",
            "keydata": "80",  # 最低血圧
            "model": "01000078",
            "tag": "622F",
        },
        {
            "date": "202511301530",
            "keydata": "72",  # 脈拍
            "model": "01000078",
            "tag": "6230",
        },
        {
            "date": "202511291030",  # 異なる日時
            "keydata": "118",  # 最高血圧
            "model": "01000078",
            "tag": "622E",
        },
    ]

    result = to_db_blood_pressure(measurements)

    # 2つの異なるタイムスタンプなので2レコード
    assert len(result) == 2


# =============================================================================
# Unit Tests: DB Operations
# =============================================================================


@pytest.mark.asyncio
async def test_upsert_body_composition_empty():
    """体組成データupsert（空リスト）"""
    result = await upsert_body_composition([])
    assert result == 0


@pytest.mark.asyncio
async def test_upsert_body_composition_success():
    """体組成データupsert（正常系）"""
    sample_record: DbBodyComposition = {
        "measured_at": "2025-11-30T06:30:00+00:00",
        "weight": 70.5,
        "body_fat_percent": 18.5,
        "model": "01000117",
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }

    mock_response = MagicMock()
    mock_response.error = None

    with patch("pipelines.services.tanita.get_supabase_client") as mock_supabase:
        mock_table = MagicMock()
        mock_table.upsert.return_value.execute.return_value = mock_response
        mock_supabase.return_value.schema.return_value.table.return_value = mock_table

        result = await upsert_body_composition([sample_record])

        assert result == 1
        mock_table.upsert.assert_called_once()


@pytest.mark.asyncio
async def test_upsert_blood_pressure_empty():
    """血圧データupsert（空リスト）"""
    result = await upsert_blood_pressure([])
    assert result == 0


@pytest.mark.asyncio
async def test_upsert_blood_pressure_success():
    """血圧データupsert（正常系）"""
    sample_record: DbBloodPressure = {
        "measured_at": "2025-11-30T06:30:00+00:00",
        "systolic": 120,
        "diastolic": 80,
        "pulse": 72,
        "model": "01000078",
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }

    mock_response = MagicMock()
    mock_response.error = None

    with patch("pipelines.services.tanita.get_supabase_client") as mock_supabase:
        mock_table = MagicMock()
        mock_table.upsert.return_value.execute.return_value = mock_response
        mock_supabase.return_value.schema.return_value.table.return_value = mock_table

        result = await upsert_blood_pressure([sample_record])

        assert result == 1
        mock_table.upsert.assert_called_once()


# =============================================================================
# Integration Tests: API Fetch
# =============================================================================


@pytest.mark.asyncio
async def test_fetch_body_composition_success(sample_api_response):
    """体組成データ取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = sample_api_response
    mock_response.headers = {"content-type": "application/json"}

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 28, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_body_composition(mock_client, "test_token", start, end)

    assert len(result) == 2
    assert result[0]["tag"] == "6021"
    assert result[0]["keydata"] == "70.5"  # keydata = 測定値


@pytest.mark.asyncio
async def test_fetch_body_composition_api_error():
    """体組成データ取得（APIエラー）"""
    error_response = {"status": "1", "error": "Authentication failed"}

    mock_response = MagicMock()
    mock_response.json.return_value = error_response
    mock_response.headers = {"content-type": "application/json"}

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 28, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_body_composition(mock_client, "test_token", start, end)

    # エラー時は空リスト
    assert len(result) == 0


@pytest.mark.asyncio
async def test_fetch_blood_pressure_success(sample_blood_pressure_api_response):
    """血圧データ取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = sample_blood_pressure_api_response
    mock_response.headers = {"content-type": "application/json"}

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 28, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_blood_pressure(mock_client, "test_token", start, end)

    assert len(result) == 3
    assert result[0]["tag"] == "622E"
    assert result[0]["keydata"] == "120"


@pytest.mark.asyncio
async def test_fetch_blood_pressure_api_error():
    """血圧データ取得（APIエラー）"""
    error_response = {"status": "1", "error": "Authentication failed"}

    mock_response = MagicMock()
    mock_response.json.return_value = error_response
    mock_response.headers = {"content-type": "application/json"}

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    start = datetime(2025, 11, 28, tzinfo=timezone.utc)
    end = datetime(2025, 11, 30, tzinfo=timezone.utc)

    result = await fetch_blood_pressure(mock_client, "test_token", start, end)

    # エラー時は空リスト
    assert len(result) == 0


# =============================================================================
# Integration Tests: Full Sync
# =============================================================================


@pytest.mark.asyncio
async def test_sync_tanita_success(mock_oauth_credentials, sample_api_response):
    """全データ同期（正常系）"""
    # グローバルキャッシュをクリア
    import pipelines.services.tanita as tanita_module

    tanita_module._auth_cache = None

    # Mock認証
    with patch(
        "pipelines.services.tanita.get_credentials",
        return_value=mock_oauth_credentials,
    ):
        # Mock API response
        mock_response = MagicMock()
        mock_response.json.return_value = sample_api_response
        mock_response.headers = {"content-type": "application/json"}

        # Mock HTTP client
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value.__aenter__.return_value = mock_client

            # Mock DB
            mock_db_response = MagicMock()
            mock_db_response.error = None

            with patch(
                "pipelines.services.tanita.get_supabase_client"
            ) as mock_supabase:
                mock_table = MagicMock()
                mock_table.upsert.return_value.execute.return_value = mock_db_response
                mock_supabase.return_value.schema.return_value.table.return_value = (
                    mock_table
                )

                # 同期実行
                result = await sync_tanita(days=3)

                # 検証
                assert result["success"] is True
                assert result["records"] >= 0
                assert result["error"] is None


@pytest.mark.asyncio
async def test_sync_tanita_failure():
    """全データ同期（失敗）"""
    # グローバルキャッシュをクリア
    import pipelines.services.tanita as tanita_module

    tanita_module._auth_cache = None

    # Mock認証失敗
    with patch(
        "pipelines.services.tanita.get_credentials", side_effect=Exception("Auth failed")
    ):
        result = await sync_tanita(days=3)

        # 検証
        assert result["success"] is False
        assert result["records"] == 0
        assert result["error"] == "Auth failed"
