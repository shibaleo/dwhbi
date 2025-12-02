---
title: Trello 同期モジュール詳細設計
---


| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 2.0.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/trello.py` |
| ステータス | 実装完了 |

## 1. 概要

### 1.1 目的

Trello API からボード、リスト、ラベル、カード、アクション、チェックリスト、カスタムフィールドのデータを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- ボード、リスト、ラベル、カードの同期
- アクション履歴の差分同期（前回同期以降のみ取得）
- チェックリスト・チェックアイテムの同期
- カスタムフィールド定義・値の同期
- 日次バッチ処理（GitHub Actions から実行）
- raw 層への生データ保存（staging 以降の変換は別モジュール）

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| ボード | Trello のプロジェクト単位。複数のリストを含む |
| リスト | カンバンの列。カードを含む |
| ラベル | カードの分類用タグ（色付き） |
| カード | タスク1件。リストに所属する |
| アクション | カードやボードへの操作履歴（移動、更新等） |
| チェックリスト | カード内のサブタスクリスト |
| チェックアイテム | チェックリスト内の個別項目 |
| カスタムフィールド | ボードごとに定義できるカスタム属性 |
| upsert | INSERT or UPDATE（重複時は更新） |
| 差分同期 | 前回同期以降の変更のみを取得 |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| ネットワーク | Trello API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| Trello API | データ取得元 | 100リクエスト/10秒/トークン |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに Trello 認証情報が保存されていること
3. `raw.trello_*` テーブルが作成済みであること
4. 仮想環境がアクティベートされていること

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| アクション上限 | 1回の取得で最大1000件 | 差分同期で対応 |
| メンバー詳細未対応 | メンバーIDのみ保存（名前は未取得） | 必要時に拡張 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                     sync_trello()                           │
│                    メインエントリーポイント                   │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ get_last_action │  │ fetch_all_data()│  │   upsert_*()    │
│    _date()      │  │ データ取得       │  │  DB書き込み群   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Supabase      │  │   Trello API    │  │   Supabase      │
│  (差分判定用)    │  │   (外部API)      │  │   raw.*         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── trello.py         # 本モジュール（Trello専用ロジック、約980行）
└── lib/
    ├── credentials.py    # 認証情報の取得・復号
    ├── db.py             # Supabaseクライアント
    ├── encryption.py     # AES-GCM暗号化
    └── logger.py         # ロギング設定
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_trello(full_sync) 呼び出し
   │
   ├─ 2. 差分同期判定
   │   ├─ full_sync=True → 全アクション取得
   │   └─ full_sync=False → get_last_action_date() で最終日時取得
   │
   ├─ 3. fetch_all_data(actions_since) でデータ取得
   │   ├─ 認証情報取得（キャッシュ優先）
   │   ├─ GET /members/{id}/boards（ボード一覧）
   │   │   └─ 各ボードに対して並列取得（6リクエスト/ボード）:
   │   │       ├─ GET /boards/{id}/lists
   │   │       ├─ GET /boards/{id}/labels
   │   │       ├─ GET /boards/{id}/cards
   │   │       ├─ GET /boards/{id}/actions?since={date}
   │   │       ├─ GET /boards/{id}/checklists
   │   │       └─ GET /boards/{id}/customFields
   │   └─ カスタムフィールド値取得（カードごと）
   │       └─ GET /cards/{id}/customFieldItems
   │
   ├─ 4. 型変換（API型 → DB型）
   │   ├─ to_db_board()
   │   ├─ to_db_list()
   │   ├─ to_db_label()
   │   ├─ to_db_card()
   │   ├─ to_db_action()
   │   ├─ to_db_checklist() / to_db_checkitem()
   │   └─ to_db_custom_field() / to_db_custom_field_item()
   │
   └─ 5. DB保存（外部キー順序を考慮）
       ├─ upsert_boards()         → raw.trello_boards
       ├─ upsert_lists()          → raw.trello_lists
       ├─ upsert_labels()         → raw.trello_labels
       ├─ upsert_cards()          → raw.trello_cards
       ├─ upsert_actions()        → raw.trello_actions
       ├─ upsert_checklists()     → raw.trello_checklists / raw.trello_checkitems
       ├─ upsert_custom_fields()  → raw.trello_custom_fields
       └─ upsert_custom_field_items() → raw.trello_custom_field_items
```

### 4.2 差分同期の仕組み

```
┌─────────────────────────────────────────────────────────────┐
│                    差分同期フロー                            │
└─────────────────────────────────────────────────────────────┘

1. 同期開始時
   └─ SELECT date FROM raw.trello_actions ORDER BY date DESC LIMIT 1
      → 最新のアクション日時を取得

2. API呼び出し
   └─ GET /boards/{id}/actions?since={last_action_date}
      → 指定日時以降のアクションのみ取得

3. 初回同期時（アクションが空の場合）
   └─ since パラメータなしで全アクション取得

4. full_sync=True の場合
   └─ 常に全アクション取得（since パラメータなし）
```

### 4.3 保存順序の理由

外部キー制約を満たすため、以下の順序で保存：

1. `trello_boards` - 最上位エンティティ
2. `trello_lists` - `board_id` → `trello_boards.id`
3. `trello_labels` - `board_id` → `trello_boards.id`
4. `trello_cards` - `board_id`, `list_id` → 参照
5. `trello_actions` - `board_id`, `card_id`, `list_id` → 参照
6. `trello_checklists` - `board_id`, `card_id` → 参照
7. `trello_checkitems` - `checklist_id` → `trello_checklists.id`
8. `trello_custom_fields` - `board_id` → `trello_boards.id`
9. `trello_custom_field_items` - `card_id`, `custom_field_id` → 参照

## 5. 設計判断（ADR）

### ADR-001: HTTPクライアント共有による高速化

**決定**: `httpx.AsyncClient` をコンテキストマネージャで共有し、コネクションプーリングを活用

**理由**:
- 各リクエストでコネクションを再確立するオーバーヘッドを削減
- 同一ホストへの複数リクエストでコネクションを再利用
- 処理時間の大幅短縮

**トレードオフ**:
- OK: 処理時間の短縮
- 注意: クライアントのライフサイクル管理が必要

### ADR-002: ボードごとの6並列取得

**決定**: 各ボードのリスト/ラベル/カード/アクション/チェックリスト/カスタムフィールドを `asyncio.gather()` で並列実行

**理由**:
- ボードが複数ある場合、順次実行では時間がかかる
- 各ボードへのリクエストは独立している
- Trello APIのレート制限（100 req/10秒）に対して十分余裕がある

**トレードオフ**:
- OK: 処理時間の短縮（ボード数 × 6リクエストが並列化）
- 注意: ボード数が多い場合はレート制限に注意

### ADR-003: アクションの差分同期

**決定**: `since` パラメータを使用して前回同期以降のアクションのみ取得

**理由**:
- アクション履歴は蓄積されるため、全取得するとデータ量が増大
- 差分取得でAPIリクエスト数とデータ転送量を削減
- 1000件上限への対応

**トレードオフ**:
- OK: 効率的なデータ取得
- 注意: 初回は全取得が必要

### ADR-004: チェックリストの正規化

**決定**: チェックリストとチェックアイテムを別テーブルで管理

**理由**:
- チェックアイテムごとの状態管理が可能
- SQLでの集計が容易
- staging層での変換が不要

**代替案**:
- カードのJSONBカラムに埋め込み → クエリが困難

### ADR-005: カスタムフィールドの分離取得

**決定**: カスタムフィールド定義とカスタムフィールド値を別々に取得

**理由**:
- 定義はボード単位、値はカード単位
- カスタムフィールドを持つボードのカードのみ値を取得
- 不要なAPIリクエストを削減

**トレードオフ**:
- OK: 効率的な取得
- 注意: カード数が多いとリクエスト数増加

## 6. データ型定義

### 6.1 API型

```python
class TrelloBoard(TypedDict):
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
    id: str
    idBoard: str
    name: str
    pos: float
    closed: bool
    subscribed: bool

class TrelloLabel(TypedDict):
    id: str
    idBoard: str
    name: str
    color: str | None

class TrelloCard(TypedDict):
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
    id: str
    idMemberCreator: str | None
    type: str
    date: str
    data: dict[str, Any]
    memberCreator: dict[str, Any] | None

class TrelloChecklist(TypedDict):
    id: str
    idBoard: str
    idCard: str
    name: str
    pos: float
    checkItems: list[dict[str, Any]]

class TrelloCustomField(TypedDict):
    id: str
    idModel: str  # board_id
    name: str
    type: str
    pos: float
    display: dict[str, Any] | None
    options: list[dict[str, Any]] | None

class TrelloCustomFieldItem(TypedDict):
    id: str
    idCustomField: str
    idModel: str  # card_id
    value: dict[str, Any] | None
    idValue: str | None
```

### 6.2 DB型

```python
class DbBoard(TypedDict):
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
    id: str
    board_id: str
    name: str
    pos: float
    is_closed: bool
    subscribed: bool

class DbLabel(TypedDict):
    id: str
    board_id: str
    name: str | None
    color: str | None

class DbCard(TypedDict):
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
    id: str
    board_id: str
    card_id: str
    name: str
    pos: float

class DbCheckitem(TypedDict):
    id: str
    checklist_id: str
    name: str
    state: str
    pos: float
    due: str | None
    id_member: str | None

class DbCustomField(TypedDict):
    id: str
    board_id: str
    name: str
    type: str
    pos: float
    display: dict[str, Any] | None
    options: list[dict[str, Any]] | None

class DbCustomFieldItem(TypedDict):
    id: str
    card_id: str
    custom_field_id: str
    value: dict[str, Any] | None
    id_value: str | None
```

### 6.3 結果型

```python
class SyncStats(TypedDict):
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
    success: bool
    stats: SyncStats

class FetchResult(TypedDict):
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
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | メソッド | パラメータ |
|---------|-------------|---------|-----------|
| Boards | `/1/members/{id}/boards` | GET | filter=open |
| Lists | `/1/boards/{id}/lists` | GET | filter=all |
| Labels | `/1/boards/{id}/labels` | GET | - |
| Cards | `/1/boards/{id}/cards` | GET | filter=all |
| Actions | `/1/boards/{id}/actions` | GET | since, limit=1000 |
| Checklists | `/1/boards/{id}/checklists` | GET | checkItems=all |
| CustomFields | `/1/boards/{id}/customFields` | GET | - |
| CustomFieldItems | `/1/cards/{id}/customFieldItems` | GET | - |

### 7.2 認証

**Query Parameter Authentication**

```
?key={api_key}&token={api_token}
```

| パラメータ | 説明 | 取得方法 |
|-----------|------|---------|
| key | API Key | [https://trello.com/app-key](https://trello.com/app-key) |
| token | API Token | API Key ページからトークン生成 |

### 7.3 リクエストパラメータ詳細

**Actions**:

| パラメータ | 説明 | 値 |
|-----------|------|-----|
| since | この日時以降のアクションを取得 | ISO 8601形式 |
| limit | 取得上限 | 1000 (最大) |
| fields | 取得フィールド | id,idMemberCreator,type,date,data,memberCreator |

**Checklists**:

| パラメータ | 説明 | 値 |
|-----------|------|-----|
| checkItems | チェックアイテム取得 | "all" |
| checkItem_fields | アイテムのフィールド | id,name,state,pos,due,idMember |

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.trello_boards` | `id` | ボード |
| `raw.trello_lists` | `id` | リスト |
| `raw.trello_labels` | `id` | ラベル |
| `raw.trello_cards` | `id` | カード |
| `raw.trello_actions` | `id` | アクション履歴 |
| `raw.trello_checklists` | `id` | チェックリスト |
| `raw.trello_checkitems` | `id` | チェックアイテム |
| `raw.trello_custom_fields` | `id` | カスタムフィールド定義 |
| `raw.trello_custom_field_items` | `id` | カスタムフィールド値 |

### 8.2 追加テーブル定義

**raw.trello_actions**:

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK (Trello Action ID) |
| board_id | TEXT | YES | ボードID |
| card_id | TEXT | YES | カードID |
| list_id | TEXT | YES | リストID |
| member_creator_id | TEXT | YES | 実行者ID |
| type | TEXT | NO | アクションタイプ |
| date | TIMESTAMPTZ | NO | 実行日時 |
| data | JSONB | YES | アクションデータ |
| member_creator | JSONB | YES | 実行者情報 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

**raw.trello_checklists**:

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| board_id | TEXT | NO | ボードID |
| card_id | TEXT | NO | カードID |
| name | TEXT | NO | チェックリスト名 |
| pos | NUMERIC | YES | 表示順序 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

**raw.trello_checkitems**:

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| checklist_id | TEXT | NO | FK → trello_checklists.id |
| name | TEXT | NO | アイテム名 |
| state | TEXT | NO | 状態 (complete/incomplete) |
| pos | NUMERIC | YES | 表示順序 |
| due | TIMESTAMPTZ | YES | 期限 |
| id_member | TEXT | YES | 担当者ID |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

**raw.trello_custom_fields**:

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| board_id | TEXT | NO | ボードID |
| name | TEXT | NO | フィールド名 |
| type | TEXT | NO | 型 (text/number/checkbox/date/list) |
| pos | NUMERIC | YES | 表示順序 |
| display | JSONB | YES | 表示設定 |
| options | JSONB | YES | 選択肢 (list型の場合) |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

**raw.trello_custom_field_items**:

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK (card_id_custom_field_id) |
| card_id | TEXT | NO | カードID |
| custom_field_id | TEXT | NO | カスタムフィールドID |
| value | JSONB | YES | 値 |
| id_value | TEXT | YES | 選択肢ID (list型の場合) |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### 8.3 インデックス

```sql
-- Actions
CREATE INDEX idx_trello_actions_board_id ON raw.trello_actions(board_id);
CREATE INDEX idx_trello_actions_card_id ON raw.trello_actions(card_id);
CREATE INDEX idx_trello_actions_date ON raw.trello_actions(date);
CREATE INDEX idx_trello_actions_type ON raw.trello_actions(type);

-- Checklists
CREATE INDEX idx_trello_checklists_board_id ON raw.trello_checklists(board_id);
CREATE INDEX idx_trello_checklists_card_id ON raw.trello_checklists(card_id);

-- Checkitems
CREATE INDEX idx_trello_checkitems_checklist_id ON raw.trello_checkitems(checklist_id);
CREATE INDEX idx_trello_checkitems_state ON raw.trello_checkitems(state);

-- Custom Fields
CREATE INDEX idx_trello_custom_fields_board_id ON raw.trello_custom_fields(board_id);
CREATE INDEX idx_trello_cf_items_card_id ON raw.trello_custom_field_items(card_id);
CREATE INDEX idx_trello_cf_items_custom_field_id ON raw.trello_custom_field_items(custom_field_id);
```

## 9. エラーハンドリング

### 9.1 エラー分類

| エラータイプ | 検出方法 | 対処 |
|------------|---------|------|
| 認証エラー | 401 | 即座に終了、認証情報確認 |
| 権限エラー | 403 | 即座に終了、ボードへのアクセス権確認 |
| Not Found | 404 | 即座に終了、リソース存在確認 |
| レート制限 | 429 | 即座に終了、待機後リトライ |
| サーバーエラー | 500系 | リトライ可能 |
| タイムアウト | httpx.TimeoutException | 60秒、ログ記録 |

### 9.2 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | api_key/api_token 未設定 | credentials.services を確認 |
| `httpx.HTTPStatusError` | APIエラー | ログを確認し原因を特定 |
| `httpx.TimeoutException` | タイムアウト（60秒） | ネットワーク状況を確認 |

## 10. パフォーマンス

### 10.1 ベンチマーク（5ボード、50カードの場合）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| 認証情報取得 | <1秒 | 0 |
| ボード一覧取得 | ~0.5秒 | 1 |
| 各ボードのデータ取得（並列） | ~3秒 | 30 (5×6) |
| カスタムフィールド値取得 | ~2秒 | ~50 |
| データ変換 | <1秒 | 0 |
| DB保存 | ~2秒 | 9 |
| **合計** | **~8秒** | **~90** |

### 10.2 計測指標

| 指標 | 説明 | 目標値 |
|------|------|--------|
| HTTP リクエスト数 | Trello API への呼び出し回数 | 1 + (ボード数×6) + カード数 |
| fetch 時間 | API 取得の合計時間 | < 10秒 |
| db 時間 | DB 保存の合計時間 | < 5秒 |
| 合計時間 | 同期全体の時間 | < 20秒 |

### 10.3 最適化手法

1. **認証情報のキャッシュ**: DB アクセス削減
2. **HTTPクライアント共有**: コネクション再利用
3. **ボードごとの並列取得**: 待ち時間の最小化
4. **差分同期**: アクション取得量の削減
5. **upsert**: 存在チェック不要

## 11. 運用

### 11.1 実行方法

**手動実行**:
```bash
# 差分同期（推奨）
python -m pipelines.services.trello

# 全同期
python -c "
import asyncio
from pipelines.services.trello import sync_trello
asyncio.run(sync_trello(full_sync=True))
"
```

**GitHub Actions**:
```yaml
# .github/workflows/sync-trello.yml
- name: Sync Trello
  env:
    TRELLO_FULL_SYNC: ${{ inputs.full_sync || 'false' }}
  run: |
    python -c "
    import asyncio
    import os
    from pipelines.services.trello import sync_trello
    full_sync = os.environ.get('TRELLO_FULL_SYNC', 'false').lower() == 'true'
    asyncio.run(sync_trello(full_sync=full_sync))
    "
```

### 11.2 必要な環境変数

`.env` ファイルに設定：

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=...
```

### 11.3 認証情報の設定

`credentials.services` テーブルに保存（暗号化済み）：

```json
{
  "api_key": "your_trello_api_key",
  "api_token": "your_trello_api_token",
  "member_id": "your_member_id"  // optional, defaults to "me"
}
```

### 11.4 ログ出力

```
[2025-12-01 12:00:00] INFO [trello] Starting Trello sync (incremental since 2025-11-30T12:00:00+00:00)
[2025-12-01 12:00:01] INFO [trello] Fetched 3 boards
[2025-12-01 12:00:02] INFO [trello] Board 'Project A': 4 lists, 6 labels, 25 cards, 15 actions, 8 checklists, 2 custom fields
[2025-12-01 12:00:03] INFO [trello] Board 'Project B': 3 lists, 5 labels, 18 cards, 10 actions, 5 checklists, 0 custom fields
[2025-12-01 12:00:04] INFO [trello] Board 'Personal': 2 lists, 4 labels, 10 cards, 5 actions, 3 checklists, 0 custom fields
[2025-12-01 12:00:04] INFO [trello] Fetched 25 custom field items
[2025-12-01 12:00:04] INFO [trello] Fetched ... (90 HTTP requests in 4.12s)
[2025-12-01 12:00:05] INFO [trello] Saving to database...
[2025-12-01 12:00:06] INFO [trello] Trello sync completed in 5.56s (fetch: 4.12s, db: 1.44s)
```

## 12. 将来対応

### 12.1 短期（1-2ヶ月）

- [x] GitHub Actions 統合
- [x] アクション履歴の取得
- [x] チェックリストの正規化

### 12.2 中期（3-6ヶ月）

- [ ] メンバー詳細情報の取得
- [ ] 添付ファイル情報の取得

### 12.3 長期（6ヶ月以降）

- [ ] Webhookによるリアルタイム同期
- [ ] 複数ワークスペース対応

## 13. 参考資料

### 13.1 外部ドキュメント

- [Trello REST API](https://developer.atlassian.com/cloud/trello/rest/)
- [Trello API Key](https://trello.com/app-key)

### 13.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/20251201000000_create_trello_tables.sql` - DBスキーマ
- `supabase/migrations/20251201010000_add_trello_additional_tables.sql` - 追加テーブル

## 14. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成 |
| 2.0.0 | 2025-12-01 | Actions, Checklists, CustomFields, 差分同期対応 |

---

**ドキュメント終了**
