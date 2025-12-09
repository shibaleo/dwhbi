"""Trello pipeline テスト"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from pipelines.services.trello import (
    DbBoard,
    DbCard,
    DbLabel,
    DbList,
    SyncResult,
    TrelloBoard,
    TrelloCard,
    TrelloLabel,
    TrelloList,
    fetch_boards,
    fetch_cards_for_board,
    fetch_labels_for_board,
    fetch_lists_for_board,
    get_auth_params,
    get_member_id,
    reset_cache,
    sync_trello,
    to_db_board,
    to_db_card,
    to_db_label,
    to_db_list,
    upsert_boards,
    upsert_cards,
    upsert_labels,
    upsert_lists,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def reset_cache_fixture():
    """各テスト前にキャッシュをリセット"""
    reset_cache()
    yield
    reset_cache()


@pytest.fixture
def mock_credentials():
    """認証情報のモック"""
    return {
        "credentials": {
            "api_key": "test_api_key_12345",
            "api_token": "test_api_token_67890",
            "member_id": "testmember123"
        },
        "expires_at": None
    }


@pytest.fixture
def sample_board() -> TrelloBoard:
    """サンプルボード"""
    return TrelloBoard(
        id="board123",
        name="Test Board",
        desc="A test board for unit tests",
        url="https://trello.com/b/board123/test-board",
        shortUrl="https://trello.com/b/board123",
        closed=False,
        idOrganization=None,
        pinned=False,
        starred=True,
        dateLastActivity="2024-01-15T10:30:00.000Z",
        dateLastView="2024-01-15T12:00:00.000Z",
        prefs={"background": "blue"},
        labelNames={"green": "Done", "red": "Urgent"}
    )


@pytest.fixture
def sample_list() -> TrelloList:
    """サンプルリスト"""
    return TrelloList(
        id="list456",
        idBoard="board123",
        name="To Do",
        pos=16384,
        closed=False,
        subscribed=False
    )


@pytest.fixture
def sample_label() -> TrelloLabel:
    """サンプルラベル"""
    return TrelloLabel(
        id="label789",
        idBoard="board123",
        name="Urgent",
        color="red"
    )


@pytest.fixture
def sample_card() -> TrelloCard:
    """サンプルカード"""
    return TrelloCard(
        id="card999",
        idBoard="board123",
        idList="list456",
        name="Test Task",
        desc="This is a test card",
        url="https://trello.com/c/card999/1-test-task",
        shortUrl="https://trello.com/c/card999",
        pos=65536,
        closed=False,
        due="2024-02-01T12:00:00.000Z",
        dueComplete=False,
        dateLastActivity="2024-01-15T14:00:00.000Z",
        idMembers=["member1", "member2"],
        idLabels=["label789"],
        labels=[{"id": "label789", "name": "Urgent", "color": "red"}],
        badges={"votes": 0, "comments": 2, "attachments": 1},
        cover={"color": None, "idAttachment": None}
    )


# =============================================================================
# Unit Tests: Authentication
# =============================================================================


@pytest.mark.asyncio
async def test_get_auth_params_success(mock_credentials):
    """認証パラメータ取得（正常系）"""
    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        params = await get_auth_params()

        assert "key" in params
        assert "token" in params
        assert params["key"] == "test_api_key_12345"
        assert params["token"] == "test_api_token_67890"


@pytest.mark.asyncio
async def test_get_auth_params_missing_key():
    """認証パラメータ取得（api_key欠損）"""
    bad_credentials = {
        "credentials": {"api_token": "token"},
        "expires_at": None
    }

    with patch("pipelines.services.trello.get_credentials", return_value=bad_credentials):
        with pytest.raises(ValueError, match="missing api_key"):
            await get_auth_params()


@pytest.mark.asyncio
async def test_get_auth_params_missing_token():
    """認証パラメータ取得（api_token欠損）"""
    bad_credentials = {
        "credentials": {"api_key": "key"},
        "expires_at": None
    }

    with patch("pipelines.services.trello.get_credentials", return_value=bad_credentials):
        with pytest.raises(ValueError, match="missing api_token"):
            await get_auth_params()


@pytest.mark.asyncio
async def test_get_member_id_success(mock_credentials):
    """メンバーID取得（正常系）"""
    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        member_id = await get_member_id()
        assert member_id == "testmember123"


@pytest.mark.asyncio
async def test_get_member_id_default():
    """メンバーID取得（未設定時はデフォルト "me"）"""
    credentials_without_member = {
        "credentials": {
            "api_key": "key",
            "api_token": "token"
        },
        "expires_at": None
    }

    with patch("pipelines.services.trello.get_credentials", return_value=credentials_without_member):
        member_id = await get_member_id()
        assert member_id == "me"


@pytest.mark.asyncio
async def test_auth_params_cached(mock_credentials):
    """認証パラメータがキャッシュされること"""
    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials) as mock_get:
        await get_auth_params()
        await get_auth_params()
        await get_auth_params()

        # get_credentialsは1回だけ呼ばれる
        assert mock_get.call_count == 1


# =============================================================================
# Unit Tests: API Client
# =============================================================================


@pytest.mark.asyncio
async def test_fetch_boards_success(mock_credentials, sample_board):
    """ボード一覧取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = [sample_board]
    mock_response.raise_for_status = MagicMock()

    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=mock_response):
            boards = await fetch_boards()

            assert len(boards) == 1
            assert boards[0]["id"] == "board123"
            assert boards[0]["name"] == "Test Board"


@pytest.mark.asyncio
async def test_fetch_lists_for_board_success(mock_credentials, sample_list):
    """リスト一覧取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = [sample_list]
    mock_response.raise_for_status = MagicMock()

    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=mock_response):
            lists = await fetch_lists_for_board("board123")

            assert len(lists) == 1
            assert lists[0]["id"] == "list456"
            assert lists[0]["name"] == "To Do"


@pytest.mark.asyncio
async def test_fetch_labels_for_board_success(mock_credentials, sample_label):
    """ラベル一覧取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = [sample_label]
    mock_response.raise_for_status = MagicMock()

    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=mock_response):
            labels = await fetch_labels_for_board("board123")

            assert len(labels) == 1
            assert labels[0]["id"] == "label789"
            assert labels[0]["color"] == "red"


@pytest.mark.asyncio
async def test_fetch_cards_for_board_success(mock_credentials, sample_card):
    """カード一覧取得（正常系）"""
    mock_response = MagicMock()
    mock_response.json.return_value = [sample_card]
    mock_response.raise_for_status = MagicMock()

    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=mock_response):
            cards = await fetch_cards_for_board("board123")

            assert len(cards) == 1
            assert cards[0]["id"] == "card999"
            assert cards[0]["name"] == "Test Task"


@pytest.mark.asyncio
async def test_fetch_boards_http_error(mock_credentials):
    """ボード一覧取得（HTTPエラー）"""
    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Unauthorized", request=MagicMock(), response=mock_response
    )

    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("httpx.AsyncClient.get", return_value=mock_response):
            with pytest.raises(httpx.HTTPStatusError):
                await fetch_boards()


# =============================================================================
# Unit Tests: DB Transformation
# =============================================================================


def test_to_db_board(sample_board):
    """API Board → DB Board変換"""
    db_board = to_db_board(sample_board)

    assert db_board["id"] == "board123"
    assert db_board["name"] == "Test Board"
    assert db_board["description"] == "A test board for unit tests"
    assert db_board["url"] == "https://trello.com/b/board123/test-board"
    assert db_board["is_closed"] is False
    assert db_board["starred"] is True
    assert db_board["prefs"] == {"background": "blue"}
    assert db_board["label_names"] == {"green": "Done", "red": "Urgent"}


def test_to_db_board_minimal():
    """API Board → DB Board変換（最小フィールド）"""
    minimal_board = TrelloBoard(
        id="min123",
        name="Minimal Board",
        desc="",
        url="",
        shortUrl="",
        closed=True,
        idOrganization=None,
        pinned=False,
        starred=False,
        dateLastActivity=None,
        dateLastView=None,
        prefs={},
        labelNames={}
    )

    db_board = to_db_board(minimal_board)

    assert db_board["id"] == "min123"
    assert db_board["description"] is None  # 空文字はNoneに変換
    assert db_board["is_closed"] is True


def test_to_db_list(sample_list):
    """API List → DB List変換"""
    db_list = to_db_list(sample_list)

    assert db_list["id"] == "list456"
    assert db_list["board_id"] == "board123"
    assert db_list["name"] == "To Do"
    assert db_list["pos"] == 16384
    assert db_list["is_closed"] is False
    assert db_list["subscribed"] is False


def test_to_db_label(sample_label):
    """API Label → DB Label変換"""
    db_label = to_db_label(sample_label)

    assert db_label["id"] == "label789"
    assert db_label["board_id"] == "board123"
    assert db_label["name"] == "Urgent"
    assert db_label["color"] == "red"


def test_to_db_label_no_name():
    """API Label → DB Label変換（名前なし）"""
    label_without_name = TrelloLabel(
        id="label000",
        idBoard="board123",
        name="",
        color="green"
    )

    db_label = to_db_label(label_without_name)

    assert db_label["name"] is None  # 空文字はNoneに変換


def test_to_db_card(sample_card):
    """API Card → DB Card変換"""
    db_card = to_db_card(sample_card)

    assert db_card["id"] == "card999"
    assert db_card["board_id"] == "board123"
    assert db_card["list_id"] == "list456"
    assert db_card["name"] == "Test Task"
    assert db_card["description"] == "This is a test card"
    assert db_card["due"] == "2024-02-01T12:00:00.000Z"
    assert db_card["due_complete"] is False
    assert db_card["id_members"] == ["member1", "member2"]
    assert db_card["id_labels"] == ["label789"]
    assert db_card["badges"] == {"votes": 0, "comments": 2, "attachments": 1}


def test_to_db_card_minimal():
    """API Card → DB Card変換（最小フィールド）"""
    minimal_card = TrelloCard(
        id="cardmin",
        idBoard="board123",
        idList="list456",
        name="Minimal Card",
        desc="",
        url="",
        shortUrl="",
        pos=0,
        closed=False,
        due=None,
        dueComplete=False,
        dateLastActivity=None,
        idMembers=[],
        idLabels=[],
        labels=[],
        badges={},
        cover={}
    )

    db_card = to_db_card(minimal_card)

    assert db_card["description"] is None
    assert db_card["due"] is None
    assert db_card["id_members"] == []
    assert db_card["id_labels"] == []


# =============================================================================
# Unit Tests: DB Write
# =============================================================================


@pytest.mark.asyncio
async def test_upsert_boards_success(sample_board):
    """ボード書き込み（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": "board123"}]

    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result

    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table

    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema

    with patch("pipelines.services.trello.get_supabase_client", return_value=mock_supabase):
        count = await upsert_boards([sample_board])

        assert count == 1
        mock_schema.table.assert_called_once_with("trello_boards")
        mock_table.upsert.assert_called_once()


@pytest.mark.asyncio
async def test_upsert_boards_empty():
    """ボード書き込み（空リスト）"""
    mock_supabase = MagicMock()
    with patch("pipelines.services.trello.get_supabase_client", return_value=mock_supabase):
        count = await upsert_boards([])
        assert count == 0


@pytest.mark.asyncio
async def test_upsert_lists_success(sample_list):
    """リスト書き込み（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": "list456"}]

    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result

    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table

    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema

    with patch("pipelines.services.trello.get_supabase_client", return_value=mock_supabase):
        count = await upsert_lists([sample_list])

        assert count == 1
        mock_schema.table.assert_called_once_with("trello_lists")


@pytest.mark.asyncio
async def test_upsert_labels_success(sample_label):
    """ラベル書き込み（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": "label789"}]

    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result

    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table

    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema

    with patch("pipelines.services.trello.get_supabase_client", return_value=mock_supabase):
        count = await upsert_labels([sample_label])

        assert count == 1
        mock_schema.table.assert_called_once_with("trello_labels")


@pytest.mark.asyncio
async def test_upsert_cards_success(sample_card):
    """カード書き込み（正常系）"""
    mock_result = MagicMock()
    mock_result.data = [{"id": "card999"}]

    mock_table = MagicMock()
    mock_table.upsert.return_value.execute.return_value = mock_result

    mock_schema = MagicMock()
    mock_schema.table.return_value = mock_table

    mock_supabase = MagicMock()
    mock_supabase.schema.return_value = mock_schema

    with patch("pipelines.services.trello.get_supabase_client", return_value=mock_supabase):
        count = await upsert_cards([sample_card])

        assert count == 1
        mock_schema.table.assert_called_once_with("trello_cards")


# =============================================================================
# Integration Tests: sync_trello
# =============================================================================


@pytest.mark.asyncio
async def test_sync_trello_success(mock_credentials, sample_board, sample_list, sample_label, sample_card):
    """sync_trello 統合テスト（正常系）"""
    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("pipelines.services.trello.fetch_boards", return_value=[sample_board]):
            with patch("pipelines.services.trello.fetch_lists_for_board", return_value=[sample_list]):
                with patch("pipelines.services.trello.fetch_labels_for_board", return_value=[sample_label]):
                    with patch("pipelines.services.trello.fetch_cards_for_board", return_value=[sample_card]):
                        with patch("pipelines.services.trello.upsert_boards", return_value=1):
                            with patch("pipelines.services.trello.upsert_lists", return_value=1):
                                with patch("pipelines.services.trello.upsert_labels", return_value=1):
                                    with patch("pipelines.services.trello.upsert_cards", return_value=1):
                                        result = await sync_trello()

                                        assert result["success"] is True
                                        assert result["stats"]["boards"] == 1
                                        assert result["stats"]["lists"] == 1
                                        assert result["stats"]["labels"] == 1
                                        assert result["stats"]["cards"] == 1


@pytest.mark.asyncio
async def test_sync_trello_no_boards(mock_credentials):
    """sync_trello 統合テスト（ボードなし）"""
    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("pipelines.services.trello.fetch_boards", return_value=[]):
            with patch("pipelines.services.trello.upsert_boards", return_value=0):
                with patch("pipelines.services.trello.upsert_lists", return_value=0):
                    with patch("pipelines.services.trello.upsert_labels", return_value=0):
                        with patch("pipelines.services.trello.upsert_cards", return_value=0):
                            result = await sync_trello()

                            assert result["success"] is True
                            assert result["stats"]["boards"] == 0
                            assert result["stats"]["lists"] == 0
                            assert result["stats"]["labels"] == 0
                            assert result["stats"]["cards"] == 0


@pytest.mark.asyncio
async def test_sync_trello_multiple_boards(mock_credentials, sample_board, sample_list, sample_label, sample_card):
    """sync_trello 統合テスト（複数ボード）"""
    board2 = TrelloBoard(
        id="board456",
        name="Second Board",
        desc="Another board",
        url="",
        shortUrl="",
        closed=False,
        idOrganization=None,
        pinned=False,
        starred=False,
        dateLastActivity=None,
        dateLastView=None,
        prefs={},
        labelNames={}
    )

    list2 = TrelloList(
        id="list789",
        idBoard="board456",
        name="Done",
        pos=32768,
        closed=False,
        subscribed=False
    )

    with patch("pipelines.services.trello.get_credentials", return_value=mock_credentials):
        with patch("pipelines.services.trello.fetch_boards", return_value=[sample_board, board2]):
            with patch("pipelines.services.trello.fetch_lists_for_board", side_effect=[[sample_list], [list2]]):
                with patch("pipelines.services.trello.fetch_labels_for_board", side_effect=[[sample_label], []]):
                    with patch("pipelines.services.trello.fetch_cards_for_board", side_effect=[[sample_card], []]):
                        with patch("pipelines.services.trello.upsert_boards", return_value=2):
                            with patch("pipelines.services.trello.upsert_lists", return_value=2):
                                with patch("pipelines.services.trello.upsert_labels", return_value=1):
                                    with patch("pipelines.services.trello.upsert_cards", return_value=1):
                                        result = await sync_trello()

                                        assert result["success"] is True
                                        assert result["stats"]["boards"] == 2
                                        assert result["stats"]["lists"] == 2
