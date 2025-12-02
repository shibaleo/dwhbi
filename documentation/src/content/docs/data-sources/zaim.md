---
title: Zaim 同期モジュール詳細設計
---


| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.1.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/zaim.py` |
| ステータス | 実装完了・テスト済み |

## 1. 概要

### 1.1 目的

Zaim API v2 から家計簿データを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- カテゴリ、ジャンル、口座、取引データの同期
- 日次バッチ処理（GitHub Actions から実行予定）
- raw 層への生データ保存（staging 以降の変換は別モジュール）

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| トランザクション | Zaim の取引記録1件（payment/income/transfer） |
| メタデータ | categories, genres, accounts の総称 |
| payment | 支出取引 |
| income | 収入取引 |
| transfer | 振替取引（口座間移動） |
| upsert | INSERT or UPDATE（重複時は更新） |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| ネットワーク | Zaim API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| Zaim API v2 | データ取得元 | 非公開（厳しくない） |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに Zaim OAuth 認証情報が保存されていること
3. `raw.zaim_*` テーブルが作成済みであること
4. 仮想環境がアクティベートされていること

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| 差分同期未実装 | 毎回全件取得（指定日数分） | days パラメータで制限 |
| 単一ユーザー | 複数ユーザー非対応 | 現状は1ユーザーのみ運用 |
| JSTタイムスタンプ | APIはtz情報なしのJST時刻を返す | UTC変換処理で対応 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                     sync_zaim()                             │
│                    メインエントリーポイント                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   fetch_all_data()      │     │     upsert_*()          │
│ OAuth 1.0a署名付きAPI取得 │     │   DB書き込み関数群       │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   Zaim API v2           │     │   Supabase raw.*        │
│   (外部API)              │     │   (PostgreSQL)          │
└─────────────────────────┘     └─────────────────────────┘
```

### 3.2 レイヤー構成

```
pipelines/
├── services/
│   └── zaim.py           # 本モジュール（Zaim専用ロジック）
└── lib/
    ├── credentials.py    # 認証情報の取得・復号
    ├── db.py             # Supabaseクライアント
    ├── encryption.py     # AES-GCM暗号化
    └── logger.py         # ロギング設定
```

### 3.3 Togglとの比較

| 項目 | Toggl | Zaim |
|------|-------|------|
| 認証方式 | Basic Auth (API Token) | OAuth 1.0a (HMAC-SHA1署名) |
| DBスキーマ | raw.toggl_* | raw.zaim_* |
| データ種類 | clients, projects, tags, entries | categories, genres, accounts, transactions |
| 固有の複雑性 | なし | JSTタイムスタンプ変換、外部キー順序 |

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_zaim(days=7) 呼び出し
   │
2. 日付範囲計算
   │  ├─ endDate = 今日 + 1日（APIは排他的終点）
   │  └─ startDate = endDate - (days + 1)
   │
3. 認証情報取得（キャッシュ優先）
   │  └─ load_credentials() → OAuth1Credentials
   │
4. fetch_all_data() で取得
   │  ├─ GET /home/user/verify（user_id取得）
   │  ├─ GET /home/category  ┐
   │  ├─ GET /home/genre     ├─ 並列取得
   │  ├─ GET /home/account   ┘
   │  └─ GET /home/money（ページネーション）
   │
5. 型変換（API型 → DB型）
   │  ├─ to_db_category()
   │  ├─ to_db_genre()
   │  ├─ to_db_account()
   │  └─ to_db_transaction()  ← JSTタイムスタンプ変換含む
   │
6. DB保存（外部キー制約順序）
   │  ├─ Phase 1: categories, accounts（並列可能）
   │  ├─ Phase 2: genres（categories依存）
   │  └─ Phase 3: transactions（genres, accounts依存）
   │
7. SyncResult 返却
```

### 4.2 保存順序の理由

外部キー制約により保存順序が制約される：

1. `zaim_genres.category_id` → `zaim_categories.id`
2. `zaim_transactions.genre_id` → `zaim_genres.id`
3. `zaim_transactions.from_account_id` → `zaim_accounts.id`
4. `zaim_transactions.to_account_id` → `zaim_accounts.id`

したがって：**categories → genres → accounts → transactions** の順序が必要。

## 5. 設計判断（ADR）

### ADR-001: OAuth 1.0a署名の自前実装

**決定**: 外部ライブラリを使わず、自前で HMAC-SHA1 署名を実装

**理由**:
- Zaim API は OAuth 1.0a を要求（OAuth 2.0 非対応）
- Python の `requests-oauthlib` は httpx と相性が悪い
- 署名ロジックは100行程度で実装可能

**代替案**:
- requests-oauthlib + requests → httpxと統一できない

**トレードオフ**:
- OK: httpxとの統一、依存削減
- 注意: 署名ロジックのバグリスクがある（テストでカバー）
- 注意: OAuth 1.0a の仕様変更時は自前対応が必要

### ADR-002: JSTタイムスタンプの変換

**決定**: API取得時にJST→UTC変換を行う

**理由**:
- Zaim API は `"2025-11-24 20:43:44"` のようにtz情報なしのJST時刻を返す
- PostgreSQL の `timestamptz` には UTC で保存するのがベストプラクティス
- 他サービス（Toggl, Fitbit）との整合性

**代替案**:
- そのまま保存 → 分析時に混乱

**トレードオフ**:
- OK: 他サービスとの整合性
- 注意: 変換処理のオーバーヘッド（微小）
- 注意: 既に tz 情報がある場合の判定ロジックが必要

### ADR-003: 認証情報のキャッシュ

**決定**: モジュールレベル変数でキャッシュ（Togglと同一パターン）

**理由**:
- `get_credentials()` は毎回 DB アクセスを伴う
- 1回の同期中に認証情報は変わらない
- 複数回の DB アクセスを1回に削減

**代替案**:
- 毎回DBアクセス → パフォーマンス低下

**トレードオフ**:
- OK: DBアクセス削減
- 注意: なし

### ADR-004: 並列取得

**決定**: メタデータ（categories, genres, accounts）を `asyncio.gather()` で並列取得

**理由**:
- 順次実行では約3秒 → 並列実行で約1秒に短縮
- 相互依存がないため並列化可能

**代替案**:
- 逐次取得 → 処理時間増

**トレードオフ**:
- OK: 処理時間短縮
- 注意: なし

### ADR-005: account_id=0 の処理

**決定**: `account_id=0` は `NULL` に変換

**理由**:
- Zaim API は「未指定」を 0 で表現
- DB の外部キー制約では 0 は無効な参照
- NULL で「未指定」を表現するのが適切

**代替案**:
- そのまま保存 → 外部キー制約違反

**トレードオフ**:
- OK: 外部キー制約を満たす
- 注意: なし

## 6. インターフェース仕様

### 6.1 メイン関数

```python
async def sync_zaim(days: int = 7) -> SyncResult:
    """Zaim データを同期

    Args:
        days: 同期する日数（今日から遡る、デフォルト7日）

    Returns:
        SyncResult: 同期結果（success, stats）

    Raises:
        ValueError: 認証情報が不正
        httpx.HTTPStatusError: APIエラー
    """
```

### 6.2 認証関数

| 関数 | 引数 | 戻り値 | 説明 |
|------|------|--------|------|
| `load_credentials()` | なし | `OAuth1Credentials` | OAuth認証情報（キャッシュ付き） |
| `reset_cache()` | なし | `None` | キャッシュをリセット（テスト用） |
| `generate_oauth_signature()` | method, url, params, consumer_secret, token_secret | `str` | HMAC-SHA1署名生成 |
| `build_oauth_header()` | method, url, credentials, query_params | `str` | Authorization ヘッダー構築 |

### 6.3 API取得関数

| 関数 | 引数 | 戻り値 | HTTPリクエスト数 |
|------|------|--------|-----------------|
| `fetch_all_data()` | start_date, end_date | `FetchResult` | 5+ |
| `api_get()` | client, endpoint, credentials, params | `Any` | 1 |

### 6.4 型変換関数

| 関数 | 入力型 | 出力型 | 特記事項 |
|------|--------|--------|----------|
| `to_db_category()` | `ZaimApiCategory` | `DbCategory` | - |
| `to_db_genre()` | `ZaimApiGenre` | `DbGenre` | - |
| `to_db_account()` | `ZaimApiAccount` | `DbAccount` | - |
| `to_db_transaction()` | `ZaimApiTransaction` | `DbTransaction` | JSTタイムスタンプ変換、account_id=0→NULL |
| `convert_zaim_timestamp_to_utc()` | `str \| None` | `str \| None` | JSTからUTCへの変換 |

### 6.5 DB書き込み関数

| 関数 | 引数 | 戻り値 | テーブル | on_conflict |
|------|------|--------|---------|-------------|
| `upsert_categories()` | `list[ZaimApiCategory]`, user_id | `int` | raw.zaim_categories | zaim_user_id,id |
| `upsert_genres()` | `list[ZaimApiGenre]`, user_id | `int` | raw.zaim_genres | zaim_user_id,id |
| `upsert_accounts()` | `list[ZaimApiAccount]`, user_id | `int` | raw.zaim_accounts | zaim_user_id,id |
| `upsert_transactions()` | `list[ZaimApiTransaction]`, user_id | `int` | raw.zaim_transactions | zaim_user_id,zaim_id |

## 7. 型定義

### 7.1 API レスポンス型

```python
class ZaimApiTransaction(TypedDict):
    id: int
    mode: str  # "payment" | "income" | "transfer"
    user_id: int
    date: str
    category_id: int
    genre_id: int
    from_account_id: int | None
    to_account_id: int | None
    amount: int
    comment: str | None
    name: str | None
    place: str | None
    created: str | None  # JST, tz情報なし
    modified: str | None  # JST, tz情報なし
    active: int | None
    receipt_id: int | None

class ZaimApiCategory(TypedDict):
    id: int
    name: str
    sort: int
    mode: str  # "payment" | "income"
    active: int

class ZaimApiGenre(TypedDict):
    id: int
    category_id: int
    name: str
    sort: int
    active: int
    parent_genre_id: int | None

class ZaimApiAccount(TypedDict):
    id: int
    name: str
    sort: int
    active: int
```

### 7.2 DB レコード型

```python
class DbCategory(TypedDict):
    id: int
    zaim_user_id: int
    name: str
    sort_order: int
    mode: str
    is_active: bool
    synced_at: str

class DbGenre(TypedDict):
    id: int
    zaim_user_id: int
    category_id: int
    name: str
    sort_order: int
    is_active: bool
    synced_at: str

class DbAccount(TypedDict):
    id: int
    zaim_user_id: int
    name: str
    sort_order: int
    is_active: bool
    synced_at: str

class DbTransaction(TypedDict):
    zaim_user_id: int
    zaim_id: int
    transaction_type: str
    amount: int
    date: str
    created_at: str  # UTC変換済み
    modified_at: str | None  # UTC変換済み
    category_id: int | None
    genre_id: int | None
    from_account_id: int | None  # 0→NULL変換済み
    to_account_id: int | None  # 0→NULL変換済み
    place: str | None
    name: str | None
    comment: str | None
    is_active: bool
    receipt_id: int | None
    synced_at: str
```

### 7.3 認証型

```python
class OAuth1Credentials(TypedDict):
    consumer_key: str
    consumer_secret: str
    access_token: str
    access_token_secret: str
```

### 7.4 結果型

```python
class SyncStats(TypedDict):
    categories: int
    genres: int
    accounts: int
    transactions: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats

class FetchResult(TypedDict):
    user_id: int
    categories: list[ZaimApiCategory]
    genres: list[ZaimApiGenre]
    accounts: list[ZaimApiAccount]
    transactions: list[ZaimApiTransaction]
    http_requests: int
    elapsed_seconds: float
```

## 8. DBスキーマ

### 8.1 raw.zaim_categories

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | Zaim カテゴリID（PK） |
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（PK） |
| name | TEXT | NO | - | カテゴリ名 |
| sort_order | INTEGER | NO | - | 表示順 |
| mode | TEXT | NO | - | "payment" or "income" |
| is_active | BOOLEAN | YES | true | アクティブか |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.2 raw.zaim_genres

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | Zaim ジャンルID（PK） |
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（PK） |
| category_id | BIGINT | NO | - | FK → zaim_categories.id |
| name | TEXT | NO | - | ジャンル名 |
| sort_order | INTEGER | NO | - | 表示順 |
| is_active | BOOLEAN | YES | true | アクティブか |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.3 raw.zaim_accounts

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | Zaim 口座ID（PK） |
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（PK） |
| name | TEXT | NO | - | 口座名 |
| sort_order | INTEGER | NO | - | 表示順 |
| is_active | BOOLEAN | YES | true | アクティブか |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.4 raw.zaim_transactions

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（PK） |
| zaim_id | BIGINT | NO | - | Zaim 取引ID（PK） |
| transaction_type | TEXT | NO | - | "payment", "income", "transfer" |
| amount | INTEGER | NO | - | 金額 |
| date | DATE | NO | - | 取引日 |
| created_at | TIMESTAMPTZ | NO | - | 作成日時（UTC） |
| modified_at | TIMESTAMPTZ | YES | - | 更新日時（UTC） |
| category_id | BIGINT | YES | - | FK → zaim_categories.id |
| genre_id | BIGINT | YES | - | FK → zaim_genres.id |
| from_account_id | BIGINT | YES | - | FK → zaim_accounts.id（振替元） |
| to_account_id | BIGINT | YES | - | FK → zaim_accounts.id（振替先） |
| place | TEXT | YES | - | 店舗・場所 |
| name | TEXT | YES | - | 品目名 |
| comment | TEXT | YES | - | コメント |
| is_active | BOOLEAN | YES | true | アクティブか |
| receipt_id | BIGINT | YES | - | レシートID |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.5 外部キー制約

```sql
ALTER TABLE raw.zaim_genres
  ADD CONSTRAINT zaim_genres_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES raw.zaim_categories(id);

ALTER TABLE raw.zaim_transactions
  ADD CONSTRAINT zaim_transactions_genre_id_fkey
  FOREIGN KEY (genre_id) REFERENCES raw.zaim_genres(id);

ALTER TABLE raw.zaim_transactions
  ADD CONSTRAINT zaim_transactions_from_account_id_fkey
  FOREIGN KEY (from_account_id) REFERENCES raw.zaim_accounts(id);

ALTER TABLE raw.zaim_transactions
  ADD CONSTRAINT zaim_transactions_to_account_id_fkey
  FOREIGN KEY (to_account_id) REFERENCES raw.zaim_accounts(id);
```

### 8.6 複合主キー

```sql
PRIMARY KEY (zaim_user_id, id)  -- categories, genres, accounts
PRIMARY KEY (zaim_user_id, zaim_id)  -- transactions
```

## 9. OAuth 1.0a 認証詳細

### 9.1 署名生成フロー

```
1. OAuth パラメータ準備
   │  ├─ oauth_consumer_key
   │  ├─ oauth_token
   │  ├─ oauth_signature_method = "HMAC-SHA1"
   │  ├─ oauth_timestamp = 現在のUNIXタイムスタンプ
   │  ├─ oauth_nonce = ランダム32文字の16進数
   │  └─ oauth_version = "1.0"
   │
2. Signature Base String 構築
   │  ├─ method = "GET"（大文字）
   │  ├─ url = URLエンコードされたエンドポイント
   │  └─ params = ソート済みパラメータ文字列（OAuth + クエリ）
   │
3. 署名キー構築
   │  └─ "{consumer_secret}&{access_token_secret}"
   │
4. HMAC-SHA1 署名生成
   │  └─ hmac.new(signing_key, base_string, sha1).digest()
   │
5. Base64 エンコード
   │
6. Authorization ヘッダー構築
   └─ "OAuth oauth_consumer_key=\"...\", oauth_signature=\"...\", ..."
```

### 9.2 署名に含めるパラメータ

| 種別 | パラメータ |
|------|-----------|
| OAuth固定 | consumer_key, token, signature_method, timestamp, nonce, version |
| クエリパラメータ | start_date, end_date, page, limit（APIリクエストごと） |

## 10. エラーハンドリング

### 10.1 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | OAuth認証情報の必須キー欠損 | credentials.services を確認 |
| `httpx.HTTPStatusError` | APIエラー（401, 403, 500等） | ログを確認し原因を特定 |
| `httpx.TimeoutException` | タイムアウト（30秒） | ネットワーク状況を確認 |

### 10.2 Transfer検証

振替取引（`mode="transfer"`）では、`from_account_id` と `to_account_id` の両方が有効な値（>0）である必要がある。不正なtransferはスキップされる。

```python
if tx["mode"] == "transfer":
    from_acc = tx.get("from_account_id")
    to_acc = tx.get("to_account_id")
    if not from_acc or not to_acc or from_acc <= 0 or to_acc <= 0:
        skipped += 1
        continue
```

## 11. ログ出力仕様

### 11.1 ログレベル

| レベル | 用途 |
|--------|------|
| INFO | 正常系の処理進捗 |
| WARNING | スキップされた取引 |
| ERROR | 処理失敗時 |

### 11.2 主要ログメッセージ

| タイミング | メッセージ例 |
|-----------|-------------|
| 開始時 | `Starting Zaim sync (7 days)` |
| fetch完了 | `Fetched 25 categories, 149 genres, 42 accounts, 89 transactions (5 HTTP requests in 3.8s)` |
| DB保存開始 | `Saving to database...` |
| 各テーブル保存 | `Saved 25 categories to raw.zaim_categories` |
| スキップ | `Skipped 2 invalid transfer transactions` |
| 完了時 | `Zaim sync completed in 5.84s (fetch: 3.8s, db: 2.04s): 25 categories, 149 genres, 42 accounts, 89 transactions` |

## 12. パフォーマンス

### 12.1 計測指標

| 指標 | 説明 | 実測値（3日分） |
|------|------|----------------|
| HTTP リクエスト数 | Zaim API への呼び出し回数 | 5回 |
| fetch 時間 | API 取得の合計時間 | 3.8秒 |
| db 時間 | DB 保存の合計時間 | 2.04秒 |
| 合計時間 | 同期全体の時間 | 5.84秒 |

### 12.2 最適化手法

1. **認証情報のキャッシュ**: DB アクセス削減
2. **HTTP クライアント共有**: コネクション再利用
3. **メタデータ並列取得**: categories/genres/accounts を同時取得
4. **upsert**: 存在チェック不要

### 12.3 将来の最適化候補

| 最適化 | 期待効果 | 優先度 |
|--------|----------|--------|
| DB書き込み並列化 | 0.5秒短縮 | 低（現状で十分高速） |
| 差分同期 | データ量削減 | 中 |

## 13. 実行方法

### 13.1 CLIから実行

```bash
# 仮想環境アクティベート
.venv\Scripts\activate

# 7日分同期（デフォルト）
python -m pipelines.services.zaim

# 14日分同期
python -m pipelines.services.zaim --days 14
python -m pipelines.services.zaim -d 14
```

### 13.2 Pythonコードから実行

```python
import asyncio
from pipelines.services.zaim import sync_zaim

result = asyncio.run(sync_zaim(days=7))
print(result)
```

### 13.3 必要な環境変数

`.env` ファイルに設定：

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=...
```

### 13.4 認証情報の設定

`credentials.services` テーブルに保存（暗号化済み）：

```json
{
  "consumer_key": "your_consumer_key",
  "consumer_secret": "your_consumer_secret",
  "access_token": "your_access_token",
  "access_token_secret": "your_access_token_secret"
}
```

## 14. テスト

### 14.1 テストファイル

`tests/pipelines/test_zaim.py`

### 14.2 テスト実行

```bash
# 全テスト実行
pytest tests/pipelines/test_zaim.py -v

# 特定カテゴリのテスト
pytest tests/pipelines/test_zaim.py -k "credentials" -v   # 認証
pytest tests/pipelines/test_zaim.py -k "oauth" -v         # OAuth署名
pytest tests/pipelines/test_zaim.py -k "timestamp" -v     # タイムスタンプ変換
pytest tests/pipelines/test_zaim.py -k "to_db" -v         # DB変換
pytest tests/pipelines/test_zaim.py -k "upsert" -v        # DB書き込み
pytest tests/pipelines/test_zaim.py -k "sync" -v          # 統合
```

### 14.3 テストケース一覧

| カテゴリ | テスト名 | 説明 |
|---------|---------|------|
| 認証 | test_load_credentials_success | 正常系 |
| 認証 | test_load_credentials_missing_key | 必須キー欠損 |
| 認証 | test_load_credentials_cached | キャッシュ検証 |
| OAuth | test_generate_oauth_signature | HMAC-SHA1署名生成 |
| OAuth | test_build_oauth_header | 認証ヘッダー構築 |
| 変換 | test_convert_zaim_timestamp_to_utc_normal | JST→UTC変換 |
| 変換 | test_convert_zaim_timestamp_to_utc_already_utc | 既にUTCの場合 |
| 変換 | test_convert_zaim_timestamp_to_utc_none | None処理 |
| 変換 | test_convert_zaim_timestamp_to_utc_empty | 空文字処理 |
| 変換 | test_to_db_category | カテゴリ変換 |
| 変換 | test_to_db_genre | ジャンル変換 |
| 変換 | test_to_db_account | 口座変換 |
| 変換 | test_to_db_transaction | トランザクション変換 |
| 変換 | test_to_db_transaction_transfer | 振替トランザクション |
| 変換 | test_to_db_transaction_zero_account_id | account_id=0→NULL |
| 変換 | test_to_db_transaction_inactive | active=0→is_active=False |
| DB | test_upsert_categories_success | カテゴリ保存 |
| DB | test_upsert_categories_empty | 空リスト |
| DB | test_upsert_genres_success | ジャンル保存 |
| DB | test_upsert_accounts_success | 口座保存 |
| DB | test_upsert_transactions_success | トランザクション保存 |
| DB | test_upsert_transactions_skip_invalid_transfer | 不正transfer スキップ |
| DB | test_upsert_transactions_empty | 空リスト |
| 統合 | test_sync_zaim_success | エンドツーエンド |
| 統合 | test_sync_zaim_date_range | 日付範囲計算 |
| 統合 | test_sync_zaim_default_days | デフォルト日数 |

## 15. 依存関係

### 15.1 外部ライブラリ

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| httpx | >= 0.27.0 | 非同期HTTPクライアント |
| supabase | >= 2.0.0 | Supabaseクライアント |

### 15.2 標準ライブラリ

| モジュール | 用途 |
|-----------|------|
| base64 | OAuth署名のBase64エンコード |
| hashlib | SHA1ハッシュ |
| hmac | HMAC署名生成 |
| secrets | nonceのランダム生成 |
| urllib.parse | URLエンコード |

### 15.3 内部モジュール

| モジュール | 用途 |
|-----------|------|
| `pipelines.lib.credentials` | 認証情報の取得・復号 |
| `pipelines.lib.db` | Supabaseクライアント（シングルトン） |
| `pipelines.lib.encryption` | AES-GCM暗号化・復号 |
| `pipelines.lib.logger` | ロギング設定 |

## 16. 既知の問題

| ID | 問題 | 影響 | 回避策 | ステータス |
|----|------|------|--------|-----------|
| #1 | 差分同期未実装 | 毎回全件取得 | days パラメータで制限 | Open |
| #2 | JSTタイムスタンプ | tz情報がない | UTC変換で対応済み | Closed |
| #3 | 不正なtransfer | スキップされる | ログで通知 | Won't Fix |

## 17. 今後の拡張予定

| 優先度 | 機能 | 説明 |
|--------|------|------|
| 高 | GitHub Actions 統合 | 定期実行ワークフロー |
| 中 | 差分同期 | modified パラメータによる増分同期 |
| 低 | 複数ユーザー対応 | 家族アカウント運用 |

## 18. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成。TypeScript版からPython版への移行完了 |
