"""Trello API 同期

Trello API を使用してボード、リスト、ラベル、カード、アクション、
チェックリスト、カスタムフィールドを取得し、raw.trello_* に保存する。
"""

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, TypedDict

import httpx

from lib.credentials_vault import get_credentials
from lib.db import get_supabase_client
from lib.logger import setup_logger

logger = setup_logger(__name__)

# =============================================================================
# Types
# =============================================================================


class TrelloBoard(TypedDict):
    """Trello API Board レスポンス"""
    id: str
    name: str
    desc: str
    url: str
    shortUrl: str
    closed: bool
    idOrganization: str | None
    pinned: bool
    starred: bool
    dateLastActivity: str | None
    dateLastView: str | None
    prefs: dict[str, Any]
    labelNames: dict[str, str]


class TrelloList(TypedDict):
    """Trello API List レスポンス"""
    id: str
    idBoard: str
    name: str
    pos: float
    closed: bool
    subscribed: bool


class TrelloLabel(TypedDict):
    """Trello API Label レスポンス"""
    id: str
    idBoard: str
    name: str
    color: str | None


class TrelloCard(TypedDict):
    """Trello API Card レスポンス"""
    id: str
    idBoard: str
    idList: str
    name: str
    desc: str
    url: str
    shortUrl: str
    pos: float
    closed: bool
    due: str | None
    dueComplete: bool
    dateLastActivity: str | None
    idMembers: list[str]
    idLabels: list[str]
    labels: list[dict[str, Any]]
    badges: dict[str, Any]
    cover: dict[str, Any]


class TrelloAction(TypedDict):
    """Trello API Action レスポンス"""
    id: str
    idMemberCreator: str | None
    type: str
    date: str
    data: dict[str, Any]
    memberCreator: dict[str, Any] | None


class TrelloChecklist(TypedDict):
    """Trello API Checklist レスポンス"""
    id: str
    idBoard: str
    idCard: str
    name: str
    pos: float
    checkItems: list[dict[str, Any]]


class TrelloCustomField(TypedDict):
    """Trello API CustomField レスポンス"""
    id: str
    idModel: str
    name: str
    type: str
    pos: float
    display: dict[str, Any] | None
    options: list[dict[str, Any]] | None


class TrelloCustomFieldItem(TypedDict):
    """Trello API CustomFieldItem レスポンス"""
    id: str
    idCustomField: str
    idModel: str  # card_id
    value: dict[str, Any] | None
    idValue: str | None


# DB Types
class DbBoard(TypedDict):
    """raw.trello_boards テーブルレコード"""
    id: str
    name: str
    description: str | None
    url: str | None
    short_url: str | None
    is_closed: bool
    id_organization: str | None
    pinned: bool
    starred: bool
    date_last_activity: str | None
    date_last_view: str | None
    prefs: dict[str, Any] | None
    label_names: dict[str, str] | None


class DbList(TypedDict):
    """raw.trello_lists テーブルレコード"""
    id: str
    board_id: str
    name: str
    pos: float
    is_closed: bool
    subscribed: bool


class DbLabel(TypedDict):
    """raw.trello_labels テーブルレコード"""
    id: str
    board_id: str
    name: str | None
    color: str | None


class DbCard(TypedDict):
    """raw.trello_cards テーブルレコード"""
    id: str
    board_id: str
    list_id: str
    name: str
    description: str | None
    url: str | None
    short_url: str | None
    pos: float
    is_closed: bool
    due: str | None
    due_complete: bool
    date_last_activity: str | None
    id_members: list[str]
    id_labels: list[str]
    labels: list[dict[str, Any]] | None
    badges: dict[str, Any] | None
    cover: dict[str, Any] | None
    checklists: list[dict[str, Any]] | None


class DbAction(TypedDict):
    """raw.trello_actions テーブルレコード"""
    id: str
    board_id: str | None
    card_id: str | None
    list_id: str | None
    member_creator_id: str | None
    type: str
    date: str
    data: dict[str, Any] | None
    member_creator: dict[str, Any] | None


class DbChecklist(TypedDict):
    """raw.trello_checklists テーブルレコード"""
    id: str
    board_id: str
    card_id: str
    name: str
    pos: float


class DbCheckitem(TypedDict):
    """raw.trello_checkitems テーブルレコード"""
    id: str
    checklist_id: str
    name: str
    state: str
    pos: float
    due: str | None
    id_member: str | None


class DbCustomField(TypedDict):
    """raw.trello_custom_fields テーブルレコード"""
    id: str
    board_id: str
    name: str
    type: str
    pos: float
    display: dict[str, Any] | None
    options: list[dict[str, Any]] | None


class DbCustomFieldItem(TypedDict):
    """raw.trello_custom_field_items テーブルレコード"""
    id: str
    card_id: str
    custom_field_id: str
    value: dict[str, Any] | None
    id_value: str | None


class SyncStats(TypedDict):
    """同期統計"""
    boards: int
    lists: int
    labels: int
    cards: int
    actions: int
    checklists: int
    checkitems: int
    custom_fields: int
    custom_field_items: int


class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    stats: SyncStats


# =============================================================================
# Configuration
# =============================================================================

BASE_URL = "https://api.trello.com/1"
MAX_RETRIES = 3
RETRY_DELAY_MS = 2000
ACTIONS_LIMIT = 1000  # アクション取得の上限


# =============================================================================
# Authentication
# =============================================================================

# キャッシュ用変数
_cached_auth_params: dict[str, str] | None = None
_cached_member_id: str | None = None


async def get_auth_params() -> dict[str, str]:
    """Trello API 認証パラメータを取得（キャッシュ付き）"""
    global _cached_auth_params
    if _cached_auth_params is not None:
        return _cached_auth_params

    result = await get_credentials("trello")
    credentials = result["credentials"]

    api_key = credentials.get("api_key")
    api_token = credentials.get("api_token")

    if not api_key:
        raise ValueError("Trello credentials missing api_key")
    if not api_token:
        raise ValueError("Trello credentials missing api_token")

    _cached_auth_params = {
        "key": api_key,
        "token": api_token,
    }
    return _cached_auth_params


async def get_member_id() -> str:
    """メンバーIDを取得（キャッシュ付き）"""
    global _cached_member_id
    if _cached_member_id is not None:
        return _cached_member_id

    result = await get_credentials("trello")
    credentials = result["credentials"]

    member_id = credentials.get("member_id", "me")
    _cached_member_id = member_id
    return _cached_member_id


def reset_cache() -> None:
    """キャッシュをリセット（テスト用）"""
    global _cached_auth_params, _cached_member_id
    _cached_auth_params = None
    _cached_member_id = None


# =============================================================================
# API Client (with shared HTTP client)
# =============================================================================


class FetchResult(TypedDict):
    """データ取得結果"""
    boards: list[TrelloBoard]
    lists: list[TrelloList]
    labels: list[TrelloLabel]
    cards: list[TrelloCard]
    actions: list[TrelloAction]
    checklists: list[TrelloChecklist]
    custom_fields: list[TrelloCustomField]
    custom_field_items: list[TrelloCustomFieldItem]
    http_requests: int
    elapsed_seconds: float


async def fetch_boards(client: httpx.AsyncClient, auth_params: dict[str, str]) -> list[TrelloBoard]:
    """ボード一覧を取得"""
    member_id = await get_member_id()
    url = f"{BASE_URL}/members/{member_id}/boards"

    params = {
        **auth_params,
        "filter": "open",
        "fields": "id,name,desc,url,shortUrl,closed,idOrganization,pinned,starred,dateLastActivity,dateLastView,prefs,labelNames",
    }

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_lists_for_board(client: httpx.AsyncClient, auth_params: dict[str, str], board_id: str) -> list[TrelloList]:
    """ボードのリスト一覧を取得"""
    url = f"{BASE_URL}/boards/{board_id}/lists"
    params = {
        **auth_params,
        "filter": "all",
        "fields": "id,idBoard,name,pos,closed,subscribed",
    }

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_labels_for_board(client: httpx.AsyncClient, auth_params: dict[str, str], board_id: str) -> list[TrelloLabel]:
    """ボードのラベル一覧を取得"""
    url = f"{BASE_URL}/boards/{board_id}/labels"
    params = {
        **auth_params,
        "fields": "id,idBoard,name,color",
    }

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_cards_for_board(client: httpx.AsyncClient, auth_params: dict[str, str], board_id: str) -> list[TrelloCard]:
    """ボードのカード一覧を取得"""
    url = f"{BASE_URL}/boards/{board_id}/cards"
    params = {
        **auth_params,
        "filter": "all",
        "fields": "id,idBoard,idList,name,desc,url,shortUrl,pos,closed,due,dueComplete,dateLastActivity,idMembers,idLabels,labels,badges,cover",
    }

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_actions_for_board(
    client: httpx.AsyncClient,
    auth_params: dict[str, str],
    board_id: str,
    since: datetime | None = None
) -> list[TrelloAction]:
    """ボードのアクション履歴を取得"""
    url = f"{BASE_URL}/boards/{board_id}/actions"
    params = {
        **auth_params,
        "limit": ACTIONS_LIMIT,
        "fields": "id,idMemberCreator,type,date,data,memberCreator",
    }

    if since:
        # ISO 8601形式で指定
        params["since"] = since.isoformat()

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_checklists_for_board(client: httpx.AsyncClient, auth_params: dict[str, str], board_id: str) -> list[TrelloChecklist]:
    """ボードのチェックリスト一覧を取得"""
    url = f"{BASE_URL}/boards/{board_id}/checklists"
    params = {
        **auth_params,
        "fields": "id,idBoard,idCard,name,pos",
        "checkItems": "all",
        "checkItem_fields": "id,name,state,pos,due,idMember",
    }

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_custom_fields_for_board(client: httpx.AsyncClient, auth_params: dict[str, str], board_id: str) -> list[TrelloCustomField]:
    """ボードのカスタムフィールド定義を取得"""
    url = f"{BASE_URL}/boards/{board_id}/customFields"
    params = {**auth_params}

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_custom_field_items_for_card(client: httpx.AsyncClient, auth_params: dict[str, str], card_id: str) -> list[TrelloCustomFieldItem]:
    """カードのカスタムフィールド値を取得"""
    url = f"{BASE_URL}/cards/{card_id}/customFieldItems"
    params = {**auth_params}

    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json() or []


async def fetch_board_data(
    client: httpx.AsyncClient,
    auth_params: dict[str, str],
    board: TrelloBoard,
    actions_since: datetime | None = None
) -> tuple[list[TrelloList], list[TrelloLabel], list[TrelloCard], list[TrelloAction], list[TrelloChecklist], list[TrelloCustomField]]:
    """ボードの全データを並列取得"""
    board_id = board["id"]

    lists, labels, cards, actions, checklists, custom_fields = await asyncio.gather(
        fetch_lists_for_board(client, auth_params, board_id),
        fetch_labels_for_board(client, auth_params, board_id),
        fetch_cards_for_board(client, auth_params, board_id),
        fetch_actions_for_board(client, auth_params, board_id, actions_since),
        fetch_checklists_for_board(client, auth_params, board_id),
        fetch_custom_fields_for_board(client, auth_params, board_id),
    )

    return lists, labels, cards, actions, checklists, custom_fields


async def fetch_all_data(actions_since: datetime | None = None) -> FetchResult:
    """全データを取得（HTTPクライアント共有で高速化）

    Args:
        actions_since: この日時以降のアクションのみ取得（None=全取得）
    """
    start_time = time.perf_counter()
    http_requests = 0

    auth_params = await get_auth_params()

    # HTTPクライアントを共有（コネクションプーリング）
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. ボード一覧を取得
        boards = await fetch_boards(client, auth_params)
        http_requests += 1
        logger.info(f"Fetched {len(boards)} boards")

        all_lists: list[TrelloList] = []
        all_labels: list[TrelloLabel] = []
        all_cards: list[TrelloCard] = []
        all_actions: list[TrelloAction] = []
        all_checklists: list[TrelloChecklist] = []
        all_custom_fields: list[TrelloCustomField] = []
        all_custom_field_items: list[TrelloCustomFieldItem] = []

        # 2. 全ボードのデータを並列取得
        if boards:
            board_tasks = [
                fetch_board_data(client, auth_params, board, actions_since)
                for board in boards
            ]
            board_results = await asyncio.gather(*board_tasks)
            http_requests += len(boards) * 6  # 各ボードで6リクエスト

            for i, (lists, labels, cards, actions, checklists, custom_fields) in enumerate(board_results):
                board_name = boards[i]["name"]
                all_lists.extend(lists)
                all_labels.extend(labels)
                all_cards.extend(cards)
                all_actions.extend(actions)
                all_checklists.extend(checklists)
                all_custom_fields.extend(custom_fields)

                logger.info(
                    f"Board '{board_name}': {len(lists)} lists, {len(labels)} labels, "
                    f"{len(cards)} cards, {len(actions)} actions, {len(checklists)} checklists, "
                    f"{len(custom_fields)} custom fields"
                )

        # 3. カスタムフィールド値を取得（カードごと）
        if all_cards and all_custom_fields:
            # カスタムフィールドがあるボードのカードのみ
            boards_with_cf = {cf["idModel"] for cf in all_custom_fields}
            cards_to_fetch = [c for c in all_cards if c["idBoard"] in boards_with_cf]

            if cards_to_fetch:
                cf_tasks = [
                    fetch_custom_field_items_for_card(client, auth_params, card["id"])
                    for card in cards_to_fetch
                ]
                cf_results = await asyncio.gather(*cf_tasks, return_exceptions=True)
                http_requests += len(cards_to_fetch)

                for card, result in zip(cards_to_fetch, cf_results):
                    if isinstance(result, Exception):
                        logger.warning(f"Failed to fetch custom field items for card {card['id']}: {result}")
                    else:
                        # idModelをcard_idに変換
                        for item in result:
                            item["idModel"] = card["id"]
                        all_custom_field_items.extend(result)

                logger.info(f"Fetched {len(all_custom_field_items)} custom field items")

    elapsed = time.perf_counter() - start_time

    return FetchResult(
        boards=boards,
        lists=all_lists,
        labels=all_labels,
        cards=all_cards,
        actions=all_actions,
        checklists=all_checklists,
        custom_fields=all_custom_fields,
        custom_field_items=all_custom_field_items,
        http_requests=http_requests,
        elapsed_seconds=round(elapsed, 2),
    )


# =============================================================================
# DB Transformation
# =============================================================================


def to_db_board(board: TrelloBoard) -> DbBoard:
    """API Board → DB Board"""
    return DbBoard(
        id=board["id"],
        name=board["name"],
        description=board.get("desc") or None,
        url=board.get("url"),
        short_url=board.get("shortUrl"),
        is_closed=board.get("closed", False),
        id_organization=board.get("idOrganization"),
        pinned=board.get("pinned", False),
        starred=board.get("starred", False),
        date_last_activity=board.get("dateLastActivity"),
        date_last_view=board.get("dateLastView"),
        prefs=board.get("prefs"),
        label_names=board.get("labelNames"),
    )


def to_db_list(lst: TrelloList) -> DbList:
    """API List → DB List"""
    return DbList(
        id=lst["id"],
        board_id=lst["idBoard"],
        name=lst["name"],
        pos=lst.get("pos", 0),
        is_closed=lst.get("closed", False),
        subscribed=lst.get("subscribed", False),
    )


def to_db_label(label: TrelloLabel) -> DbLabel:
    """API Label → DB Label"""
    return DbLabel(
        id=label["id"],
        board_id=label["idBoard"],
        name=label.get("name") or None,
        color=label.get("color"),
    )


def to_db_card(card: TrelloCard) -> DbCard:
    """API Card → DB Card"""
    return DbCard(
        id=card["id"],
        board_id=card["idBoard"],
        list_id=card["idList"],
        name=card["name"],
        description=card.get("desc") or None,
        url=card.get("url"),
        short_url=card.get("shortUrl"),
        pos=card.get("pos", 0),
        is_closed=card.get("closed", False),
        due=card.get("due"),
        due_complete=card.get("dueComplete", False),
        date_last_activity=card.get("dateLastActivity"),
        id_members=card.get("idMembers", []),
        id_labels=card.get("idLabels", []),
        labels=card.get("labels"),
        badges=card.get("badges"),
        cover=card.get("cover"),
        checklists=None,  # 別テーブルで管理
    )


def to_db_action(action: TrelloAction) -> DbAction:
    """API Action → DB Action"""
    data = action.get("data", {})
    return DbAction(
        id=action["id"],
        board_id=data.get("board", {}).get("id") if data.get("board") else None,
        card_id=data.get("card", {}).get("id") if data.get("card") else None,
        list_id=data.get("list", {}).get("id") if data.get("list") else None,
        member_creator_id=action.get("idMemberCreator"),
        type=action["type"],
        date=action["date"],
        data=data,
        member_creator=action.get("memberCreator"),
    )


def to_db_checklist(checklist: TrelloChecklist) -> DbChecklist:
    """API Checklist → DB Checklist"""
    return DbChecklist(
        id=checklist["id"],
        board_id=checklist["idBoard"],
        card_id=checklist["idCard"],
        name=checklist["name"],
        pos=checklist.get("pos", 0),
    )


def to_db_checkitem(item: dict[str, Any], checklist_id: str) -> DbCheckitem:
    """API CheckItem → DB CheckItem"""
    return DbCheckitem(
        id=item["id"],
        checklist_id=checklist_id,
        name=item["name"],
        state=item.get("state", "incomplete"),
        pos=item.get("pos", 0),
        due=item.get("due"),
        id_member=item.get("idMember"),
    )


def to_db_custom_field(cf: TrelloCustomField) -> DbCustomField:
    """API CustomField → DB CustomField"""
    return DbCustomField(
        id=cf["id"],
        board_id=cf["idModel"],
        name=cf["name"],
        type=cf["type"],
        pos=cf.get("pos", 0),
        display=cf.get("display"),
        options=cf.get("options"),
    )


def to_db_custom_field_item(item: TrelloCustomFieldItem) -> DbCustomFieldItem:
    """API CustomFieldItem → DB CustomFieldItem"""
    return DbCustomFieldItem(
        id=f"{item['idModel']}_{item['idCustomField']}",
        card_id=item["idModel"],
        custom_field_id=item["idCustomField"],
        value=item.get("value"),
        id_value=item.get("idValue"),
    )


# =============================================================================
# DB Write
# =============================================================================


async def upsert_boards(boards: list[TrelloBoard]) -> int:
    """ボードを raw.trello_boards に upsert"""
    if not boards:
        return 0

    records = [to_db_board(b) for b in boards]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_boards")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} boards to raw.trello_boards")
    return saved_count


async def upsert_lists(lists: list[TrelloList]) -> int:
    """リストを raw.trello_lists に upsert"""
    if not lists:
        return 0

    records = [to_db_list(lst) for lst in lists]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_lists")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} lists to raw.trello_lists")
    return saved_count


async def upsert_labels(labels: list[TrelloLabel]) -> int:
    """ラベルを raw.trello_labels に upsert"""
    if not labels:
        return 0

    records = [to_db_label(lbl) for lbl in labels]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_labels")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} labels to raw.trello_labels")
    return saved_count


async def upsert_cards(cards: list[TrelloCard]) -> int:
    """カードを raw.trello_cards に upsert"""
    if not cards:
        return 0

    records = [to_db_card(c) for c in cards]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_cards")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} cards to raw.trello_cards")
    return saved_count


async def upsert_actions(actions: list[TrelloAction]) -> int:
    """アクションを raw.trello_actions に upsert"""
    if not actions:
        return 0

    records = [to_db_action(a) for a in actions]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_actions")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} actions to raw.trello_actions")
    return saved_count


async def upsert_checklists(checklists: list[TrelloChecklist]) -> tuple[int, int]:
    """チェックリストとアイテムを upsert"""
    if not checklists:
        return 0, 0

    # チェックリストを保存
    checklist_records = [to_db_checklist(cl) for cl in checklists]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_checklists")
        .upsert(checklist_records, on_conflict="id")
        .execute()
    )
    checklists_count = len(result.data) if result.data else 0
    logger.info(f"Saved {checklists_count} checklists to raw.trello_checklists")

    # チェックアイテムを保存
    checkitem_records = []
    for cl in checklists:
        for item in cl.get("checkItems", []):
            checkitem_records.append(to_db_checkitem(item, cl["id"]))

    if checkitem_records:
        result = (
            supabase.schema("raw")
            .table("trello_checkitems")
            .upsert(checkitem_records, on_conflict="id")
            .execute()
        )
        checkitems_count = len(result.data) if result.data else 0
    else:
        checkitems_count = 0

    logger.info(f"Saved {checkitems_count} checkitems to raw.trello_checkitems")
    return checklists_count, checkitems_count


async def upsert_custom_fields(custom_fields: list[TrelloCustomField]) -> int:
    """カスタムフィールドを raw.trello_custom_fields に upsert"""
    if not custom_fields:
        return 0

    records = [to_db_custom_field(cf) for cf in custom_fields]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_custom_fields")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} custom fields to raw.trello_custom_fields")
    return saved_count


async def upsert_custom_field_items(items: list[TrelloCustomFieldItem]) -> int:
    """カスタムフィールド値を raw.trello_custom_field_items に upsert"""
    if not items:
        return 0

    records = [to_db_custom_field_item(item) for item in items]
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_custom_field_items")
        .upsert(records, on_conflict="id")
        .execute()
    )

    saved_count = len(result.data) if result.data else 0
    logger.info(f"Saved {saved_count} custom field items to raw.trello_custom_field_items")
    return saved_count


# =============================================================================
# Sync State
# =============================================================================


async def get_last_action_date() -> datetime | None:
    """DBから最新のアクション日時を取得"""
    supabase = get_supabase_client()
    result = (
        supabase.schema("raw")
        .table("trello_actions")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )

    if result.data and len(result.data) > 0:
        date_str = result.data[0]["date"]
        # ISO 8601形式をパース
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))

    return None


# =============================================================================
# Main Sync Function
# =============================================================================


async def sync_trello(full_sync: bool = False) -> SyncResult:
    """Trello データを同期

    Args:
        full_sync: Trueの場合、全アクションを取得（差分ではなく全取得）
                   Falseの場合、前回同期以降のアクションのみ取得
    """
    total_start = time.perf_counter()

    # 差分取得の開始日時を決定
    actions_since = None
    if not full_sync:
        actions_since = await get_last_action_date()
        if actions_since:
            logger.info(f"Starting Trello sync (incremental since {actions_since.isoformat()})")
        else:
            logger.info("Starting Trello sync (initial full sync - no previous actions found)")
    else:
        logger.info("Starting Trello sync (full sync requested)")

    # 1. API からデータ取得
    logger.info("Fetching all data...")
    fetch_result = await fetch_all_data(actions_since)
    logger.info(
        f"Fetched {len(fetch_result['boards'])} boards, "
        f"{len(fetch_result['lists'])} lists, "
        f"{len(fetch_result['labels'])} labels, "
        f"{len(fetch_result['cards'])} cards, "
        f"{len(fetch_result['actions'])} actions, "
        f"{len(fetch_result['checklists'])} checklists, "
        f"{len(fetch_result['custom_fields'])} custom fields, "
        f"{len(fetch_result['custom_field_items'])} custom field items "
        f"({fetch_result['http_requests']} HTTP requests in {fetch_result['elapsed_seconds']}s)"
    )

    # 2. DB に保存（外部キー順序を考慮）
    db_start = time.perf_counter()
    logger.info("Saving to database...")

    boards_count = await upsert_boards(fetch_result['boards'])
    lists_count = await upsert_lists(fetch_result['lists'])
    labels_count = await upsert_labels(fetch_result['labels'])
    cards_count = await upsert_cards(fetch_result['cards'])
    actions_count = await upsert_actions(fetch_result['actions'])
    checklists_count, checkitems_count = await upsert_checklists(fetch_result['checklists'])
    custom_fields_count = await upsert_custom_fields(fetch_result['custom_fields'])
    custom_field_items_count = await upsert_custom_field_items(fetch_result['custom_field_items'])

    db_elapsed = round(time.perf_counter() - db_start, 2)

    stats = SyncStats(
        boards=boards_count,
        lists=lists_count,
        labels=labels_count,
        cards=cards_count,
        actions=actions_count,
        checklists=checklists_count,
        checkitems=checkitems_count,
        custom_fields=custom_fields_count,
        custom_field_items=custom_field_items_count,
    )

    total_elapsed = round(time.perf_counter() - total_start, 2)

    logger.info(
        f"Trello sync completed in {total_elapsed}s "
        f"(fetch: {fetch_result['elapsed_seconds']}s, db: {db_elapsed}s)"
    )

    return SyncResult(
        success=True,
        stats=stats,
    )


# =============================================================================
# CLI Entry Point
# =============================================================================

if __name__ == "__main__":
    asyncio.run(sync_trello())
