# Trello 同期モジュール詳細設計

| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.0.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/trello.py` |
| ステータス | 実装完了 |

## 1. 概要

### 1.1 目的

Trello API からボード、リスト、ラベル、カードのデータを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- ボード、リスト、ラベル、カードの同期
- 日次バッチ処理（GitHub Actions から実行予定）
- raw 層への生データ保存（staging 以降の変換は別モジュール）

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| ボード | Trello のプロジェクト単位。複数のリストを含む |
| リスト | カンバンの列。カードを含む |
| ラベル | カードの分類用タグ（色付き） |
| カード | タスク1件。リストに所属する |
| upsert | INSERT or UPDATE（重複時は更新） |

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
| アクション未対応 | カードへのアクション履歴は取得不可 | 将来対応予定 |
| メンバー詳細未対応 | メンバーIDのみ保存（名前は未取得） | 必要時に拡張 |
| チェックリスト | JSONBとして保存 | staging層で展開 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                     sync_trello()                           │
│                    メインエントリーポイント                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│ fetch_all_data()        │     │     upsert_*()          │
│ ボード→各種データ取得     │     │   DB書き込み関数群       │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   Trello API            │     │   Supabase raw.*        │
│   (外部API)              │     │   (PostgreSQL)          │
└─────────────────────────┘     └─────────────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── trello.py         # 本モジュール（Trello専用ロジック、約500行）
└── lib/
    ├── credentials.py    # 認証情報の取得・復号
    ├── db.py             # Supabaseクライアント
    ├── encryption.py     # AES-GCM暗号化
    └── logger.py         # ロギング設定
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_trello() 呼び出し
   │
   ├─ 2. 認証情報取得（キャッシュ優先）
   │   ├─ get_auth_params() → API Key + Token
   │   └─ get_member_id() → メンバーID（デフォルト: "me"）
   │
   ├─ 3. fetch_all_data() でデータ取得
   │   ├─ GET /members/{id}/boards（ボード一覧）
   │   │   └─ 各ボードに対して並列取得:
   │   │       ├─ GET /boards/{id}/lists
   │   │       ├─ GET /boards/{id}/labels
   │   │       └─ GET /boards/{id}/cards
   │
   ├─ 4. 型変換（API型 → DB型）
   │   ├─ to_db_board()
   │   ├─ to_db_list()
   │   ├─ to_db_label()
   │   └─ to_db_card()
   │
   └─ 5. DB保存（外部キー順序を考慮）
       ├─ upsert_boards()  → raw.trello_boards
       ├─ upsert_lists()   → raw.trello_lists
       ├─ upsert_labels()  → raw.trello_labels
       └─ upsert_cards()   → raw.trello_cards
```

### 4.2 保存順序の理由

外部キー制約を満たすため、以下の順序で保存：

1. `trello_boards` - 最上位エンティティ
2. `trello_lists` - `board_id` → `trello_boards.id`
3. `trello_labels` - `board_id` → `trello_boards.id`
4. `trello_cards` - `board_id` → `trello_boards.id`, `list_id` → `trello_lists.id`

## 5. 設計判断（ADR）

### ADR-001: ボードごとの並列取得

**決定**: 各ボードのリスト/ラベル/カードを `asyncio.gather()` で並列実行

**理由**:
- ボードが複数ある場合、順次実行では時間がかかる
- 各ボードへのリクエストは独立している
- Trello APIのレート制限（100 req/10秒）に対して十分余裕がある

**トレードオフ**:
- OK: 処理時間の短縮（ボード数 × 3リクエストが並列化）
- 注意: ボード数が多い場合はレート制限に注意

### ADR-002: 認証情報のキャッシュ

**決定**: モジュールレベル変数でキャッシュ

**理由**:
- `get_credentials()` は毎回 DB アクセスを伴う
- 1回の同期中に認証情報は変わらない
- 複数回の DB アクセスを1回に削減

**トレードオフ**:
- OK: DBアクセス削減
- 注意: テスト時は `reset_cache()` で明示的にリセットが必要

### ADR-003: オープンボードのみ取得

**決定**: `filter=open` でオープン状態のボードのみ取得

**理由**:
- アーカイブ済みボードは通常参照されない
- データ量削減
- 必要であれば filter パラメータを変更可能

**代替案**:
- `filter=all` で全ボード取得 → データ量増大

### ADR-004: チェックリストのJSONB保存

**決定**: カードのチェックリストは `checklists` カラムにJSONBとして保存

**理由**:
- チェックリストの構造は複雑（items, state など）
- raw層では加工せずそのまま保存
- staging層で必要に応じて展開

**トレードオフ**:
- OK: スキーマの簡素化
- 注意: 直接クエリでの集計が困難

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
```

### 6.3 結果型

```python
class SyncStats(TypedDict):
    boards: int
    lists: int
    labels: int
    cards: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats

class FetchResult(TypedDict):
    boards: list[TrelloBoard]
    lists: list[TrelloList]
    labels: list[TrelloLabel]
    cards: list[TrelloCard]
    http_requests: int
    elapsed_seconds: float
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | メソッド | レスポンス |
|---------|-------------|---------|-----------|
| Boards | `/1/members/{id}/boards` | GET | `[{board}, ...]` |
| Lists | `/1/boards/{id}/lists` | GET | `[{list}, ...]` |
| Labels | `/1/boards/{id}/labels` | GET | `[{label}, ...]` |
| Cards | `/1/boards/{id}/cards` | GET | `[{card}, ...]` |

### 7.2 認証

**Query Parameter Authentication**

```
?key={api_key}&token={api_token}
```

| パラメータ | 説明 | 取得方法 |
|-----------|------|---------|
| key | API Key | [https://trello.com/app-key](https://trello.com/app-key) |
| token | API Token | API Key ページからトークン生成 |

### 7.3 リクエストパラメータ

**Boards**:

| パラメータ | 説明 | 値 |
|-----------|------|-----|
| filter | ボードのフィルタ | "open" (デフォルト) |
| fields | 取得フィールド | "id,name,desc,..." |

**Cards**:

| パラメータ | 説明 | 値 |
|-----------|------|-----|
| filter | カードのフィルタ | "all" (アーカイブ含む) |
| fields | 取得フィールド | "id,name,desc,..." |
| checklists | チェックリスト | "all" |

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.trello_boards` | `id` | ボード |
| `raw.trello_lists` | `id` | リスト |
| `raw.trello_labels` | `id` | ラベル |
| `raw.trello_cards` | `id` | カード |

### 8.2 テーブル定義

**raw.trello_boards**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (Trello ID) |
| name | TEXT | NO | - | ボード名 |
| description | TEXT | YES | - | 説明 |
| url | TEXT | YES | - | URL |
| short_url | TEXT | YES | - | 短縮URL |
| is_closed | BOOLEAN | YES | false | アーカイブ済みか |
| id_organization | TEXT | YES | - | 組織ID |
| pinned | BOOLEAN | YES | false | ピン留め |
| starred | BOOLEAN | YES | false | スター付き |
| date_last_activity | TIMESTAMPTZ | YES | - | 最終アクティビティ日時 |
| date_last_view | TIMESTAMPTZ | YES | - | 最終閲覧日時 |
| prefs | JSONB | YES | - | 設定情報 |
| label_names | JSONB | YES | - | ラベル名マッピング |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.trello_lists**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (Trello ID) |
| board_id | TEXT | NO | - | FK → trello_boards.id |
| name | TEXT | NO | - | リスト名 |
| pos | NUMERIC | YES | - | 表示順序 |
| is_closed | BOOLEAN | YES | false | アーカイブ済みか |
| subscribed | BOOLEAN | YES | false | 購読中か |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.trello_labels**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (Trello ID) |
| board_id | TEXT | NO | - | FK → trello_boards.id |
| name | TEXT | YES | - | ラベル名 |
| color | TEXT | YES | - | 色 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.trello_cards**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (Trello ID) |
| board_id | TEXT | NO | - | FK → trello_boards.id |
| list_id | TEXT | NO | - | FK → trello_lists.id |
| name | TEXT | NO | - | カード名 |
| description | TEXT | YES | - | 説明 |
| url | TEXT | YES | - | URL |
| short_url | TEXT | YES | - | 短縮URL |
| pos | NUMERIC | YES | - | 表示順序 |
| is_closed | BOOLEAN | YES | false | アーカイブ済みか |
| due | TIMESTAMPTZ | YES | - | 期限日時 |
| due_complete | BOOLEAN | YES | false | 期限完了フラグ |
| date_last_activity | TIMESTAMPTZ | YES | - | 最終アクティビティ日時 |
| id_members | TEXT[] | YES | - | 割り当てメンバーID配列 |
| id_labels | TEXT[] | YES | - | ラベルID配列 |
| labels | JSONB | YES | - | ラベル詳細 |
| badges | JSONB | YES | - | バッジ情報 |
| cover | JSONB | YES | - | カバー画像情報 |
| checklists | JSONB | YES | - | チェックリスト |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.3 外部キー制約

```sql
ALTER TABLE raw.trello_lists
  ADD CONSTRAINT trello_lists_board_id_fkey
  FOREIGN KEY (board_id) REFERENCES raw.trello_boards(id);

ALTER TABLE raw.trello_labels
  ADD CONSTRAINT trello_labels_board_id_fkey
  FOREIGN KEY (board_id) REFERENCES raw.trello_boards(id);

ALTER TABLE raw.trello_cards
  ADD CONSTRAINT trello_cards_board_id_fkey
  FOREIGN KEY (board_id) REFERENCES raw.trello_boards(id);

ALTER TABLE raw.trello_cards
  ADD CONSTRAINT trello_cards_list_id_fkey
  FOREIGN KEY (list_id) REFERENCES raw.trello_lists(id);
```

### 8.4 インデックス

```sql
CREATE INDEX idx_trello_lists_board_id ON raw.trello_lists(board_id);
CREATE INDEX idx_trello_labels_board_id ON raw.trello_labels(board_id);
CREATE INDEX idx_trello_cards_board_id ON raw.trello_cards(board_id);
CREATE INDEX idx_trello_cards_list_id ON raw.trello_cards(list_id);
CREATE INDEX idx_trello_cards_due ON raw.trello_cards(due) WHERE due IS NOT NULL;
CREATE INDEX idx_trello_cards_date_last_activity ON raw.trello_cards(date_last_activity);
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
| タイムアウト | httpx.TimeoutException | 30秒、ログ記録 |

### 9.2 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | api_key/api_token 未設定 | credentials.services を確認 |
| `httpx.HTTPStatusError` | APIエラー | ログを確認し原因を特定 |
| `httpx.TimeoutException` | タイムアウト（30秒） | ネットワーク状況を確認 |

## 10. パフォーマンス

### 10.1 ベンチマーク（5ボード、50カードの場合）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| 認証情報取得 | <1秒 | 0 |
| ボード一覧取得 | ~0.5秒 | 1 |
| 各ボードのデータ取得（並列） | ~2秒 | 15 (5×3) |
| データ変換 | <1秒 | 0 |
| DB保存 | ~1秒 | 4 |
| **合計** | **~4秒** | **16** |

### 10.2 計測指標

| 指標 | 説明 | 目標値 |
|------|------|--------|
| HTTP リクエスト数 | Trello API への呼び出し回数 | 1 + (ボード数×3) |
| fetch 時間 | API 取得の合計時間 | < 5秒 |
| db 時間 | DB 保存の合計時間 | < 3秒 |
| 合計時間 | 同期全体の時間 | < 10秒 |

### 10.3 最適化手法

1. **認証情報のキャッシュ**: DB アクセス削減
2. **ボードごとの並列取得**: 待ち時間の最小化
3. **upsert**: 存在チェック不要

## 11. テスト戦略

### 11.1 テスト構成

| テストタイプ | ファイル | 件数 | カバレッジ |
|------------|---------|------|-----------|
| Unit Tests | `tests/pipelines/test_trello.py` | 20 | Helper, Transform, DB |
| Integration Tests | 同上 | 3 | API Fetch, Full Sync |
| **合計** | - | **23** | **~90%** |

### 11.2 主要テストケース

**Authentication (5件)**:
- `test_get_auth_params_success`: 正常系
- `test_get_auth_params_missing_key`: api_key欠損
- `test_get_auth_params_missing_token`: api_token欠損
- `test_get_member_id_success`: 正常系
- `test_get_member_id_default`: デフォルト値
- `test_auth_params_cached`: キャッシュ動作

**API Fetch (5件)**:
- `test_fetch_boards_success`: ボード取得
- `test_fetch_lists_for_board_success`: リスト取得
- `test_fetch_labels_for_board_success`: ラベル取得
- `test_fetch_cards_for_board_success`: カード取得
- `test_fetch_boards_http_error`: HTTPエラー

**Data Transformation (6件)**:
- `test_to_db_board`: ボード変換
- `test_to_db_board_minimal`: 最小フィールド
- `test_to_db_list`: リスト変換
- `test_to_db_label`: ラベル変換
- `test_to_db_label_no_name`: 名前なしラベル
- `test_to_db_card`: カード変換
- `test_to_db_card_minimal`: 最小フィールド

**DB Operations (5件)**:
- `test_upsert_boards_success`: ボード保存
- `test_upsert_boards_empty`: 空リスト
- `test_upsert_lists_success`: リスト保存
- `test_upsert_labels_success`: ラベル保存
- `test_upsert_cards_success`: カード保存

**Full Sync (3件)**:
- `test_sync_trello_success`: エンドツーエンド
- `test_sync_trello_no_boards`: ボードなし
- `test_sync_trello_multiple_boards`: 複数ボード

### 11.3 テスト実行

```bash
# 全テスト実行
pytest tests/pipelines/test_trello.py -v

# 特定カテゴリのテスト
pytest tests/pipelines/test_trello.py -k "upsert" -v   # DB書き込み
pytest tests/pipelines/test_trello.py -k "auth" -v     # 認証
pytest tests/pipelines/test_trello.py -k "fetch" -v    # API取得
pytest tests/pipelines/test_trello.py -k "sync" -v     # 統合

# カバレッジ測定
pytest tests/pipelines/test_trello.py --cov=pipelines.services.trello
```

## 12. 運用

### 12.1 実行方法

**手動実行**:
```bash
# 仮想環境アクティベート
source .venv/Scripts/activate

# 同期実行
python -m pipelines.services.trello
```

**GitHub Actions（予定）**:
```yaml
# .github/workflows/sync-daily.yml
- name: Sync Trello
  run: python -m pipelines.services.trello
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY }}
```

### 12.2 必要な環境変数

`.env` ファイルに設定：

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=...
```

### 12.3 認証情報の設定

`credentials.services` テーブルに保存（暗号化済み）：

```json
{
  "api_key": "your_trello_api_key",
  "api_token": "your_trello_api_token",
  "member_id": "your_member_id"  // optional, defaults to "me"
}
```

### 12.4 ログ出力

```
[2025-12-01 12:00:00] INFO [trello] Starting Trello sync
[2025-12-01 12:00:01] INFO [trello] Fetched 3 boards
[2025-12-01 12:00:01] INFO [trello] Board 'Project A': 4 lists, 6 labels, 25 cards
[2025-12-01 12:00:02] INFO [trello] Board 'Project B': 3 lists, 5 labels, 18 cards
[2025-12-01 12:00:02] INFO [trello] Board 'Personal': 2 lists, 4 labels, 10 cards
[2025-12-01 12:00:02] INFO [trello] Fetched 3 boards, 9 lists, 15 labels, 53 cards (10 HTTP requests in 2.34s)
[2025-12-01 12:00:02] INFO [trello] Saving to database...
[2025-12-01 12:00:03] INFO [trello] Saved 3 boards to raw.trello_boards
[2025-12-01 12:00:03] INFO [trello] Saved 9 lists to raw.trello_lists
[2025-12-01 12:00:03] INFO [trello] Saved 15 labels to raw.trello_labels
[2025-12-01 12:00:04] INFO [trello] Saved 53 cards to raw.trello_cards
[2025-12-01 12:00:04] INFO [trello] Trello sync completed in 3.56s: 3 boards, 9 lists, 15 labels, 53 cards
```

### 12.5 モニタリング

**監視項目**:
- 同期成功/失敗回数
- データ件数（boards, lists, labels, cards）
- 処理時間
- レート制限到達回数

**アラート条件**:
- 3日連続同期失敗
- 処理時間が30秒超

## 13. 将来対応

### 13.1 短期（1-2ヶ月）

- [ ] GitHub Actions 統合
- [ ] アクション履歴の取得

### 13.2 中期（3-6ヶ月）

- [ ] メンバー詳細情報の取得
- [ ] チェックリストの正規化（staging層）

### 13.3 長期（6ヶ月以降）

- [ ] Webhookによるリアルタイム同期
- [ ] 複数ワークスペース対応

## 14. 参考資料

### 14.1 外部ドキュメント

- [Trello REST API](https://developer.atlassian.com/cloud/trello/rest/)
- [Trello API Key](https://trello.com/app-key)

### 14.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/20251201000000_create_trello_tables.sql` - DBスキーマ
- `tests/pipelines/test_trello.py` - テストコード

## 15. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成 |

---

**ドキュメント終了**
