"""Zaim pipeline テスト"""

from datetime import date, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pipelines.services.zaim import (
    DbTransaction,
    OAuth1Credentials,
    SyncResult,
    ZaimApiCategory,
    ZaimApiGenre,
    ZaimApiAccount,
    ZaimApiTransaction,
    build_oauth_header,
    convert_zaim_timestamp_to_utc,
    generate_oauth_signature,
    load_credentials,
    reset_cache,
    sync_zaim,
    to_db_category,
    to_db_genre,
    to_db_account,
    to_db_transaction,
    upsert_categories,
    upsert_genres,
    upsert_accounts,
    upsert_transactions,
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
def mock_credentials():
    """認証情報のモック"""
    return {
        "credentials": {
            "consumer_key": "test_consumer_key",
            "consumer_secret": "test_consumer_secret",
            "access_token": "test_access_token",
            "access_token_secret": "test_access_token_secret",
        },
        "expires_at": None,
    }


@pytest.fixture
def oauth_credentials() -> OAuth1Credentials:
    """OAuth1認証情報"""
    return OAuth1Credentials(
        consumer_key="test_consumer_key",
        consumer_secret="test_consumer_secret",
        access_token="test_access_token",
        access_token_secret="test_access_token_secret",
    )


@pytest.fixture
def sample_category() -> ZaimApiCategory:
    """サンプルカテゴリ"""
    return ZaimApiCategory(
        id=101,
        name="食費",
        sort=1,
        mode="payment",
        active=1,
    )


@pytest.fixture
def sample_genre() -> ZaimApiGenre:
    """サンプルジャンル"""
    return ZaimApiGenre(
        id=201,
        category_id=101,
        name="外食",
        sort=1,
        active=1,
        parent_genre_id=None,
    )


@pytest.fixture
def sample_account() -> ZaimApiAccount:
    """サンプル口座"""
    return ZaimApiAccount(
        id=301,
        name="現金",
        sort=1,
        active=1,
    )


@pytest.fixture
def sample_transaction() -> ZaimApiTransaction:
    """サンプルトランザクション"""
    return ZaimApiTransaction(
        id=1001,
        mode="payment",
        user_id=12345,
        date="2025-12-01",
        category_id=101,
        genre_id=201,
        from_account_id=301,
        to_account_id=None,
        amount=1500,
        comment="ランチ",
        name="牛丼屋",
        place="新宿",
        created="2025-12-01 12:30:00",
        modified="2025-12-01 12:30:00",
        active=1,
        receipt_id=None,
    )


@pytest.fixture
def sample_transfer() -> ZaimApiTransaction:
    """サンプル振替トランザクション"""
    return ZaimApiTransaction(
        id=1002,
        mode="transfer",
        user_id=12345,
        date="2025-12-01",
        category_id=0,
        genre_id=0,
        from_account_id=301,
        to_account_id=302,
        amount=10000,
        comment="ATM引き出し",
        name=None,
        place=None,
        created="2025-12-01 18:00:00",
        modified=None,
        active=1,
        receipt_id=None,
    )


# =============================================================================
# Unit Tests: Authentication
# =============================================================================


@pytest.mark.asyncio
async def test_load_credentials_success(mock_credentials):
    """認証情報読み込み（正常系）"""
    with patch("pipelines.services.zaim.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_credentials
        
        creds = await load_credentials()
        
        assert creds["consumer_key"] == "test_consumer_key"
        assert creds["consumer_secret"] == "test_consumer_secret"
        assert creds["access_token"] == "test_access_token"
        assert creds["access_token_secret"] == "test_access_token_secret"


@pytest.mark.asyncio
async def test_load_credentials_missing_key():
    """認証情報読み込み（キー欠損）"""
    bad_creds = {
        "credentials": {
            "consumer_key": "test",
            # consumer_secret 欠損
        },
        "expires_at": None,
    }
    
    with patch("pipelines.services.zaim.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = bad_creds
        
        with pytest.raises(ValueError, match="missing consumer_secret"):
            await load_credentials()


@pytest.mark.asyncio
async def test_load_credentials_cached(mock_credentials):
    """認証情報キャッシュの検証"""
    with patch("pipelines.services.zaim.get_credentials", new_callable=AsyncMock) as mock:
        mock.return_value = mock_credentials
        
        # 1回目
        creds1 = await load_credentials()
        # 2回目（キャッシュから）
        creds2 = await load_credentials()
        
        assert creds1 == creds2
        # get_credentialsは1回だけ呼ばれる
        mock.assert_called_once()


# =============================================================================
# Unit Tests: OAuth 1.0a Signature
# =============================================================================


def test_generate_oauth_signature(oauth_credentials):
    """OAuth署名生成"""
    params = {
        "oauth_consumer_key": oauth_credentials["consumer_key"],
        "oauth_token": oauth_credentials["access_token"],
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": "1234567890",
        "oauth_nonce": "abc123",
        "oauth_version": "1.0",
    }
    
    signature = generate_oauth_signature(
        method="GET",
        url="https://api.zaim.net/v2/home/money",
        params=params,
        consumer_secret=oauth_credentials["consumer_secret"],
        token_secret=oauth_credentials["access_token_secret"],
    )
    
    # 署名はBase64文字列
    assert isinstance(signature, str)
    assert len(signature) > 0


def test_build_oauth_header(oauth_credentials):
    """OAuth認証ヘッダー構築"""
    header = build_oauth_header(
        method="GET",
        url="https://api.zaim.net/v2/home/money",
        credentials=oauth_credentials,
        query_params={"page": "1", "limit": "100"},
    )
    
    assert header.startswith("OAuth ")
    assert "oauth_consumer_key" in header
    assert "oauth_token" in header
    assert "oauth_signature" in header
    assert "oauth_nonce" in header


# =============================================================================
# Unit Tests: Timestamp Conversion
# =============================================================================


def test_convert_zaim_timestamp_to_utc_normal():
    """JSTタイムスタンプ変換（通常）"""
    # JST 20:43:44 = UTC 11:43:44
    result = convert_zaim_timestamp_to_utc("2025-11-24 20:43:44")
    
    assert result is not None
    assert "2025-11-24T11:43:44" in result
    assert "+00:00" in result or "Z" in result


def test_convert_zaim_timestamp_to_utc_already_utc():
    """JSTタイムスタンプ変換（既にUTC）"""
    result = convert_zaim_timestamp_to_utc("2025-11-24T11:43:44Z")
    assert result == "2025-11-24T11:43:44Z"


def test_convert_zaim_timestamp_to_utc_none():
    """JSTタイムスタンプ変換（None）"""
    result = convert_zaim_timestamp_to_utc(None)
    assert result is None


def test_convert_zaim_timestamp_to_utc_empty():
    """JSTタイムスタンプ変換（空文字）"""
    result = convert_zaim_timestamp_to_utc("")
    assert result is None


# =============================================================================
# Unit Tests: DB Transformation
# =============================================================================


def test_to_db_category(sample_category):
    """Category変換"""
    result = to_db_category(sample_category, user_id=12345)
    
    assert result["id"] == 101
    assert result["zaim_user_id"] == 12345
    assert result["name"] == "食費"
    assert result["sort_order"] == 1
    assert result["mode"] == "payment"
    assert result["is_active"] is True
    assert "synced_at" in result


def test_to_db_genre(sample_genre):
    """Genre変換"""
    result = to_db_genre(sample_genre, user_id=12345)
    
    assert result["id"] == 201
    assert result["zaim_user_id"] == 12345
    assert result["category_id"] == 101
    assert result["name"] == "外食"
    assert result["sort_order"] == 1
    assert result["is_active"] is True


def test_to_db_account(sample_account):
    """Account変換"""
    result = to_db_account(sample_account, user_id=12345)
    
    assert result["id"] == 301
    assert result["zaim_user_id"] == 12345
    assert result["name"] == "現金"
    assert result["sort_order"] == 1
    assert result["is_active"] is True


def test_to_db_transaction(sample_transaction):
    """Transaction変換（通常）"""
    result = to_db_transaction(sample_transaction, user_id=12345)
    
    assert result["zaim_user_id"] == 12345
    assert result["zaim_id"] == 1001
    assert result["transaction_type"] == "payment"
    assert result["amount"] == 1500
    assert result["date"] == "2025-12-01"
    assert result["category_id"] == 101
    assert result["genre_id"] == 201
    assert result["from_account_id"] == 301
    assert result["to_account_id"] is None
    assert result["place"] == "新宿"
    assert result["name"] == "牛丼屋"
    assert result["comment"] == "ランチ"
    assert result["is_active"] is True
    # JSTタイムスタンプがUTCに変換されている
    assert "T03:30:00" in result["created_at"]  # JST 12:30 = UTC 03:30


def test_to_db_transaction_transfer(sample_transfer):
    """Transaction変換（振替）"""
    result = to_db_transaction(sample_transfer, user_id=12345)
    
    assert result["transaction_type"] == "transfer"
    assert result["from_account_id"] == 301
    assert result["to_account_id"] == 302
    assert result["category_id"] is None  # 0はNULLに変換


def test_to_db_transaction_zero_account_id():
    """Transaction変換（account_id=0はNULL）"""
    tx = ZaimApiTransaction(
        id=1003,
        mode="payment",
        user_id=12345,
        date="2025-12-01",
        category_id=101,
        genre_id=201,
        from_account_id=0,  # 0はNULLに
        to_account_id=0,    # 0はNULLに
        amount=500,
        comment=None,
        name=None,
        place=None,
        created=None,
        modified=None,
        active=1,
        receipt_id=None,
    )
    
    result = to_db_transaction(tx, user_id=12345)
    
    assert result["from_account_id"] is None
    assert result["to_account_id"] is None


def test_to_db_transaction_inactive():
    """Transaction変換（非アクティブ）"""
    tx = ZaimApiTransaction(
        id=1004,
        mode="payment",
        user_id=12345,
        date="2025-12-01",
        category_id=101,
        genre_id=201,
        from_account_id=301,
        to_account_id=None,
        amount=500,
        comment=None,
        name=None,
        place=None,
        created=None,
        modified=None,
        active=0,  # 非アクティブ
        receipt_id=None,
    )
    
    result = to_db_transaction(tx, user_id=12345)
    
    assert result["is_active"] is False


# =============================================================================
# Unit Tests: DB Write
# =============================================================================


@pytest.mark.asyncio
async def test_upsert_categories_success(sample_category):
    """カテゴリupsert（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": 101}]
    
    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result
    
    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table
    
    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema
    
    with patch("pipelines.services.zaim.get_supabase_client", return_value=mock_supabase):
        count = await upsert_categories([sample_category], user_id=12345)
        
        assert count == 1
        mock_schema.table.assert_called_once_with("zaim_categories")


@pytest.mark.asyncio
async def test_upsert_categories_empty():
    """カテゴリupsert（空リスト）"""
    count = await upsert_categories([], user_id=12345)
    assert count == 0


@pytest.mark.asyncio
async def test_upsert_genres_success(sample_genre):
    """ジャンルupsert（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": 201}]
    
    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result
    
    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table
    
    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema
    
    with patch("pipelines.services.zaim.get_supabase_client", return_value=mock_supabase):
        count = await upsert_genres([sample_genre], user_id=12345)
        
        assert count == 1
        mock_schema.table.assert_called_once_with("zaim_genres")


@pytest.mark.asyncio
async def test_upsert_accounts_success(sample_account):
    """口座upsert（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": 301}]
    
    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result
    
    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table
    
    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema
    
    with patch("pipelines.services.zaim.get_supabase_client", return_value=mock_supabase):
        count = await upsert_accounts([sample_account], user_id=12345)
        
        assert count == 1
        mock_schema.table.assert_called_once_with("zaim_accounts")


@pytest.mark.asyncio
async def test_upsert_transactions_success(sample_transaction):
    """トランザクションupsert（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"zaim_id": 1001}]
    
    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result
    
    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table
    
    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema
    
    with patch("pipelines.services.zaim.get_supabase_client", return_value=mock_supabase):
        count = await upsert_transactions([sample_transaction], user_id=12345)
        
        assert count == 1
        mock_schema.table.assert_called_once_with("zaim_transactions")


@pytest.mark.asyncio
async def test_upsert_transactions_skip_invalid_transfer():
    """トランザクションupsert（不正な振替をスキップ）"""
    invalid_transfer = ZaimApiTransaction(
        id=1005,
        mode="transfer",
        user_id=12345,
        date="2025-12-01",
        category_id=0,
        genre_id=0,
        from_account_id=0,   # 不正
        to_account_id=None,  # 不正
        amount=10000,
        comment=None,
        name=None,
        place=None,
        created=None,
        modified=None,
        active=1,
        receipt_id=None,
    )
    
    mock_supabase = MagicMock()
    with patch("pipelines.services.zaim.get_supabase_client", return_value=mock_supabase):
        count = await upsert_transactions([invalid_transfer], user_id=12345)
        
        # 不正な振替はスキップされる
        assert count == 0


@pytest.mark.asyncio
async def test_upsert_transactions_empty():
    """トランザクションupsert（空リスト）"""
    count = await upsert_transactions([], user_id=12345)
    assert count == 0


# =============================================================================
# Integration Tests: sync_zaim
# =============================================================================


@pytest.mark.asyncio
async def test_sync_zaim_success(
    mock_credentials,
    sample_category,
    sample_genre,
    sample_account,
    sample_transaction,
):
    """sync_zaim 統合テスト（正常系）"""
    fetch_result = {
        "user_id": 12345,
        "categories": [sample_category],
        "genres": [sample_genre],
        "accounts": [sample_account],
        "transactions": [sample_transaction],
        "http_requests": 5,
        "elapsed_seconds": 1.5,
    }
    
    with patch("pipelines.services.zaim.get_credentials", new_callable=AsyncMock) as mock_creds:
        mock_creds.return_value = mock_credentials
        
        with patch("pipelines.services.zaim.fetch_all_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = fetch_result
            
            with patch("pipelines.services.zaim.upsert_categories", new_callable=AsyncMock) as mock_cat:
                mock_cat.return_value = 1
                
                with patch("pipelines.services.zaim.upsert_genres", new_callable=AsyncMock) as mock_gen:
                    mock_gen.return_value = 1
                    
                    with patch("pipelines.services.zaim.upsert_accounts", new_callable=AsyncMock) as mock_acc:
                        mock_acc.return_value = 1
                        
                        with patch("pipelines.services.zaim.upsert_transactions", new_callable=AsyncMock) as mock_tx:
                            mock_tx.return_value = 1
                            
                            result = await sync_zaim(days=7)
                            
                            assert result["success"] is True
                            assert result["stats"]["categories"] == 1
                            assert result["stats"]["genres"] == 1
                            assert result["stats"]["accounts"] == 1
                            assert result["stats"]["transactions"] == 1


@pytest.mark.asyncio
async def test_sync_zaim_date_range():
    """sync_zaim の日付範囲計算"""
    fetch_result = {
        "user_id": 12345,
        "categories": [],
        "genres": [],
        "accounts": [],
        "transactions": [],
        "http_requests": 1,
        "elapsed_seconds": 0.5,
    }
    
    with patch("pipelines.services.zaim.load_credentials", new_callable=AsyncMock):
        with patch("pipelines.services.zaim.fetch_all_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = fetch_result
            
            with patch("pipelines.services.zaim.upsert_categories", new_callable=AsyncMock, return_value=0):
                with patch("pipelines.services.zaim.upsert_genres", new_callable=AsyncMock, return_value=0):
                    with patch("pipelines.services.zaim.upsert_accounts", new_callable=AsyncMock, return_value=0):
                        with patch("pipelines.services.zaim.upsert_transactions", new_callable=AsyncMock, return_value=0):
                            await sync_zaim(days=7)
                            
                            # 日付範囲を検証
                            call_args = mock_fetch.call_args
                            start_str = call_args[0][0]
                            end_str = call_args[0][1]
                            
                            today = date.today()
                            # endDate = 明日
                            expected_end = (today + timedelta(days=1)).isoformat()
                            # startDate = endDate - (days + 1) = 今日 - 7日
                            expected_start = (today - timedelta(days=7)).isoformat()
                            
                            assert start_str == expected_start
                            assert end_str == expected_end


@pytest.mark.asyncio
async def test_sync_zaim_default_days():
    """sync_zaim のデフォルト日数（7日）"""
    fetch_result = {
        "user_id": 12345,
        "categories": [],
        "genres": [],
        "accounts": [],
        "transactions": [],
        "http_requests": 1,
        "elapsed_seconds": 0.5,
    }
    
    with patch("pipelines.services.zaim.load_credentials", new_callable=AsyncMock):
        with patch("pipelines.services.zaim.fetch_all_data", new_callable=AsyncMock) as mock_fetch:
            mock_fetch.return_value = fetch_result
            
            with patch("pipelines.services.zaim.upsert_categories", new_callable=AsyncMock, return_value=0):
                with patch("pipelines.services.zaim.upsert_genres", new_callable=AsyncMock, return_value=0):
                    with patch("pipelines.services.zaim.upsert_accounts", new_callable=AsyncMock, return_value=0):
                        with patch("pipelines.services.zaim.upsert_transactions", new_callable=AsyncMock, return_value=0):
                            result = await sync_zaim()  # デフォルト days=7
                            
                            assert result["success"] is True
                            mock_fetch.assert_called_once()
