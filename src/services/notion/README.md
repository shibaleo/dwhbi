# Notion 同期モジュール

Notion データベースを Supabase `notion` スキーマに同期する。

## 設計思想

### メタテーブル駆動

同期対象のテーブル情報はコードや設定ファイルではなく、**Notion内のメタテーブル（TB__METADATA）** で管理する。

```
環境変数: NOTION_METADATA_TABLE_ID (唯一の機密情報)
                    ↓
┌─────────────────────────────────────────────────────────────┐
│  TB__METADATA (Notionメタテーブル)                        │
│    - どのNotionテーブルを同期するか                          │
│    - Supabase側のテーブル名                                  │
│    - 同期タイプ（master / transaction）                      │
│    - 有効/無効フラグ                                         │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│  sync_daily.ts                                              │
│    1. メタテーブルから enabled=true のレコードを取得         │
│    2. 各テーブルに対して sync_type に応じた同期を実行        │
└─────────────────────────────────────────────────────────────┘
```

**メリット:**
- コードに機密情報（テーブルID）を含まない（リポジトリはpublic）
- 環境変数は1つだけ（NOTION_SYNC_CONFIG_DB_ID）
- Notionアプリ（モバイル含む）から同期設定を変更可能
- チェックボックスで同期の有効/無効を切り替え

---

## クイックスタート

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `NOTION_INTEGRATION_SECRET` | Yes | Notion Internal Integration Token |
| `NOTION_METADATA_TABLE_ID` | Yes | メタテーブル（TB__METADATA）のID |
| `NOTION_SYNC_DAYS` | No | トランザクション同期の日数（デフォルト: 3） |
| `NOTION_DISCOVER_DATABASES` | No | データベース自動検出を有効化（デフォルト: false） |
| `NOTION_SKIP_SCHEMA_SYNC` | No | スキーマ同期をスキップ（テーブル作成済みの場合、デフォルト: false） |
| `DEBUG` | No | 詳細ログ表示（スキップされた設定の詳細等、デフォルト: false） |

### 実行コマンド

#### deno taskコマンド（推奨）

```bash
# 日次同期（通常版）
deno task sync:notion

# 日次同期（高速版 - スキーマ同期スキップ）
deno task sync:notion:fast

# データベース自動検出
deno task notion:discover
```

#### 直接実行（環境変数カスタマイズ）

```bash
# 日次同期（メタテーブルで enabled=true のテーブルを同期）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# スキーマ同期をスキップして高速化（テーブル作成済みの場合）
NOTION_SKIP_SCHEMA_SYNC=true deno run --allow-env --allow-net --allow-read sync_daily.ts

# データベース自動検出を有効にして同期
NOTION_DISCOVER_DATABASES=true deno run --allow-env --allow-net --allow-read sync_daily.ts

# 詳細ログで実行（スキップされた設定の詳細を表示）
DEBUG=true deno run --allow-env --allow-net --allow-read sync_daily.ts

# スキーマ同期（DDL生成、手動実行用）
deno run --allow-env --allow-net --allow-read sync_schema.ts

# 全件同期（初回移行・リカバリ用）
deno run --allow-env --allow-net --allow-read sync_all.ts
```

---

## アーキテクチャ

### 同期タイプ

| タイプ | 説明 | 同期方式 | ユースケース |
|--------|------|---------|-------------|
| `master` | マスターデータ | 全件取得 → TRUNCATE → INSERT | 設定、マッピング、マスタ |
| `transaction` | トランザクションデータ | last_edited_time で差分取得 → UPSERT | ログ、記録、履歴 |

### データパイプライン

```
TB__SYNC_CONFIG (メタテーブル)
         ↓
    設定読み込み
         ↓
┌────────────────────────────────────────────────────────────────┐
│  対象テーブルごとにループ                                       │
│                                                                │
│  Notion DB (例: TB__SAUNA)                                     │
│         ↓                                                      │
│    プロパティ取得 (API-retrieve-a-database)                    │
│         ↓                                                      │
│    データ取得 (API-post-database-query)                        │
│         ↓                                                      │
│    型変換 (Notion型 → PostgreSQL型)                            │
│         ↓                                                      │
│    Supabase書き込み (notion.sauna)                             │
└────────────────────────────────────────────────────────────────┘
```

### ファイル構成と実装順序

実装はデータパイプラインの上流から下流へ、依存関係に従って進める。

```
実装順序:

  1. types.ts          型定義（他の全ファイルが依存）
       ↓
  2. auth.ts           認証（API呼び出しの前提）
       ↓
  3. api.ts            APIクライアント（auth.tsに依存）
       ↓
  4. fetch_config.ts   メタテーブル読み込み（api.tsに依存）
       ↓
  5. type_mapping.ts   型変換ロジック（types.tsに依存）
       ↓
  6. fetch_data.ts     データ取得（api.ts, fetch_config.tsに依存）
       ↓
  7. write_db.ts       DB書き込み（type_mapping.tsに依存）
       ↓
  8. sync_daily.ts     日次同期オーケストレーター
       ↓
  9. sync_all.ts       全件同期（sync_daily.tsと共通ロジック）
       ↓
 10. sync_schema.ts    スキーマ同期（DDL生成、独立ツール）
```

#### 1. types.ts

**責務:** 型定義の一元管理

| 定義 | 説明 |
|------|------|
| `NotionApiDatabase` | Notion DB構造（プロパティ定義） |
| `NotionApiPage` | Notionページ（レコード） |
| `NotionApiPropertyValue` | プロパティ値の型（title, rich_text, number等） |
| `SyncConfig` | メタテーブルから読み込んだ設定 |
| `SyncResult` | 同期結果（success, stats, errors） |
| `SyncStats` | 同期統計（テーブルごとの件数） |

```typescript
// 主要な型
export interface SyncConfig {
  name: string;
  databaseId: string;
  supabaseTable: string;
  supabaseSchema: string;
  syncType: "master" | "transaction";
  enabled: boolean;
  lastSyncedAt: string | null;
}
```

#### 2. auth.ts

**責務:** Notion API認証・HTTPクライアント

| エクスポート | 説明 |
|-------------|------|
| `notionFetch<T>(endpoint, options?)` | 認証付きfetch（Bearer Token） |
| `NOTION_API_VERSION` | APIバージョン定数 |

```typescript
// 使用例
const db = await notionFetch<NotionApiDatabase>(`/databases/${id}`);
```

環境変数: `NOTION_INTEGRATION_SECRET`

#### 3. api.ts

**責務:** Notion APIエンドポイントのラッパー

| エクスポート | 説明 |
|-------------|------|
| `getDatabase(id)` | DB構造（プロパティ定義）取得 |
| `queryDatabase(id, filter?, sorts?)` | ページ一覧取得（ページネーション対応） |
| `queryDatabaseByLastEdited(id, after)` | last_edited_time でフィルター |

```typescript
// 使用例
const pages = await queryDatabase(databaseId);
const recentPages = await queryDatabaseByLastEdited(databaseId, lastSyncedAt);
```

#### 4. fetch_config.ts

**責務:** メタテーブル（TB__METADATA）から同期設定を取得

| エクスポート | 説明 |
|-------------|------|
| `fetchSyncConfigs()` | 全設定を取得 |
| `fetchEnabledConfigs()` | enabled=true のみ取得 |
| `updateLastSyncedAt(pageId, timestamp)` | 同期完了後に更新 |

```typescript
// 使用例
const configs = await fetchEnabledConfigs();
for (const config of configs) {
  await syncTable(config);
  await updateLastSyncedAt(config.pageId, new Date().toISOString());
}
```

環境変数: `NOTION_METADATA_TABLE_ID`

#### 5. type_mapping.ts

**責務:** Notion型 ↔ PostgreSQL型の変換

| エクスポート | 説明 |
|-------------|------|
| `notionTypeToPostgres(type)` | Notion型 → PostgreSQL型 |
| `propertyNameToColumn(name)` | プロパティ名 → カラム名（スネークケース） |
| `extractPropertyValue(prop)` | NotionプロパティからJSの値を抽出 |
| `generateCreateTableDDL(config, properties)` | CREATE TABLE文生成 |
| `generateAlterTableDDL(config, added, removed)` | ALTER TABLE文生成 |

```typescript
// 型マッピング例
notionTypeToPostgres("title")       // → "text NOT NULL"
notionTypeToPostgres("number")      // → "numeric"
notionTypeToPostgres("date")        // → "jsonb"
notionTypeToPostgres("multi_select") // → "text[]"

// カラム名変換例
propertyNameToColumn("1st-period(min)") // → "1st_period_min"
```

#### 6. fetch_data.ts

**責務:** データ取得オーケストレーション

| エクスポート | 説明 |
|-------------|------|
| `fetchAllPages(config)` | 全ページ取得（master同期用） |
| `fetchRecentPages(config, since)` | 差分取得（transaction同期用） |
| `fetchDatabaseSchema(config)` | プロパティ定義取得 |

```typescript
// master同期
const allPages = await fetchAllPages(config);

// transaction同期
const recentPages = await fetchRecentPages(config, config.lastSyncedAt);
```

#### 7. write_db.ts

**責務:** Supabaseへの動的テーブル書き込み

| エクスポート | 説明 |
|-------------|------|
| `createNotionDbClient(schema)` | スキーマ指定のSupabaseクライアント |
| `transformPageToRecord(page, properties)` | Notionページ → DBレコード変換 |
| `upsertRecords(client, table, records)` | バッチupsert |
| `truncateAndInsert(client, table, records)` | TRUNCATE → INSERT（master用） |
| `syncMasterTable(config, pages)` | master同期の実行 |
| `syncTransactionTable(config, pages)` | transaction同期の実行 |

```typescript
// master同期（全件置換）
await syncMasterTable(config, allPages);

// transaction同期（差分upsert）
await syncTransactionTable(config, recentPages);
```

#### 8. sync_daily.ts

**責務:** 日次同期オーケストレーター（GitHub Actions用エントリーポイント）

| エクスポート | 説明 |
|-------------|------|
| `syncNotionByDays(days?)` | 日次同期の実行 |

```typescript
// 内部フロー
0. (オプショナル) discoverAndRegisterDatabases() で新規データベースを検出・登録
1. executeSchemaSync() でテーブル自動作成
2. fetchEnabledConfigs() で同期対象を取得
3. 各configに対して:
   - master: fetchAllPages → syncMasterTable
   - transaction: fetchRecentPages → syncTransactionTable
4. updateLastSyncedAt() で最終同期日時を更新
5. SyncResult を返却
```

**データベース自動検出:**

環境変数 `NOTION_DISCOVER_DATABASES=true` を設定すると、同期前にNotionワークスペース内の全データベースを検索し、TB__METADATAに未登録のデータベースを `enabled=false` で自動登録します。

**登録時のデフォルト値:**
- `supabase_schema`: `notion`
- `enabled`: `false`（無効）
- `sync_type`: 未設定（ユーザーが選択するまでスキップ）
- `supabase_table`: 未設定（ユーザーが設定するまでスキップ）

登録後はNotionで `supabase_table` と `sync_type` を設定し、`enabled` を有効にする必要があります。これらが未設定のデータベースは自動的にスキップされます。

#### 9. sync_all.ts

**責務:** 全件同期（初回移行・リカバリ用）

| エクスポート | 説明 |
|-------------|------|
| `syncAllNotionData(options?)` | 全テーブルを全件同期 |

CLIオプション:
- `--table <name>`: 特定テーブルのみ同期
- `--force`: enabled=false でも同期

#### 10. sync_schema.ts

**責務:** スキーマ同期（DDL生成ツール）

| エクスポート | 説明 |
|-------------|------|
| `generateSchemaDDL()` | 全テーブルのDDLを生成 |
| `compareSchema(config)` | Notion vs Supabase のスキーマ比較 |

```typescript
// 出力例
-- 新規テーブル: notion.new_table
CREATE TABLE notion.new_table (
  id text PRIMARY KEY,
  ...
);

-- カラム追加: notion.existing_table
ALTER TABLE notion.existing_table
ADD COLUMN new_column text;
```

---

### ファイル一覧（実行可能フラグ付き）

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | 型定義（API・DB・同期結果） | No |
| `auth.ts` | Notion API認証 | No |
| `api.ts` | Notion APIクライアント | No |
| `fetch_config.ts` | メタテーブルから設定取得 | No |
| `type_mapping.ts` | Notion型 → PostgreSQL型変換 | No |
| `fetch_data.ts` | データ取得オーケストレーション | No |
| `write_db.ts` | DB書き込み（動的テーブル対応） | No |
| `discover_databases.ts` | データベース検出・登録 | Yes |
| `sync_daily.ts` | 日次同期（discover統合済） | Yes |
| `sync_all.ts` | 全件同期（初回移行用） | Yes |
| `sync_schema.ts` | スキーマ同期（DDL生成） | Yes |

---

## メタテーブル (TB__METADATA)

### プロパティ定義

| プロパティ | Notion型 | 必須 | 説明 |
|-----------|---------|------|------|
| Name | title | ✅ | 識別名（例: "GCAL_MAPPING"） |
| database_id | rich_text | ✅ | 同期対象のNotion DB ID |
| supabase_table | rich_text | ✅ | Supabase側のテーブル名 |
| supabase_schema | rich_text | | スキーマ名（デフォルト: "notion"） |
| sync_type | select | ✅ | "master" / "transaction" |
| enabled | checkbox | ✅ | 同期を有効にするか |
| last_synced_at | rich_text | | 最終同期日時（自動更新） |
| description | rich_text | | メモ |

### 設定例

| Name | database_id | supabase_table | sync_type | enabled |
|------|-------------|----------------|-----------|---------|
| GCAL_MAPPING | 2b32cd76... | gcal_mapping | master | ✅ |
| SAUNA | 2a62cd76... | sauna | transaction | ✅ |

---

## 型マッピング

### Notion型 → PostgreSQL型

| Notion型 | PostgreSQL型 | 備考 |
|----------|-------------|------|
| title | text NOT NULL | 主キーではない（Notion IDを主キーに使用） |
| rich_text | text | |
| number | numeric | |
| checkbox | boolean | |
| date | jsonb | `{start, end, time_zone}` 構造を保持 |
| select | text | |
| multi_select | text[] | |
| url | text | |
| email | text | |
| phone_number | text | |
| relation | text[] | 関連ページIDの配列 |
| rollup | jsonb | 計算結果をそのまま保存 |
| formula | varies | 計算結果の型に依存 |
| files | jsonb | ファイル情報の配列 |
| people | text[] | ユーザーIDの配列 |
| created_time | timestamptz | |
| created_by | text | ユーザーID |
| last_edited_time | timestamptz | |
| last_edited_by | text | ユーザーID |
| status | text | |
| unique_id | text | |

### 共通カラム（全テーブルに自動追加）

| カラム | 型 | 説明 |
|--------|------|------|
| id | text PRIMARY KEY | Notion ページID |
| created_at | timestamptz | Notion created_time |
| updated_at | timestamptz | Notion last_edited_time |
| synced_at | timestamptz | 同期日時（Supabase側で自動設定） |

---

## データベーススキーマ

### notion スキーマ

同期対象テーブルは `notion` スキーマに作成される。

```sql
-- 例: notion.gcal_mapping
CREATE TABLE notion.gcal_mapping (
  id text PRIMARY KEY,                    -- Notion ページID
  name text NOT NULL,                     -- title プロパティ
  ja_name text,
  gcal_color_id text,
  gcal_hex text,
  gcal_color_name text,
  description text,
  toggl_hex text,
  created_at timestamptz,
  updated_at timestamptz,
  synced_at timestamptz DEFAULT now()
);

-- 例: notion.sauna
CREATE TABLE notion.sauna (
  id text PRIMARY KEY,                    -- Notion ページID
  place text NOT NULL,                    -- title プロパティ
  date jsonb,                             -- {start, end, time_zone}
  "1st_period_min" numeric,               -- カラム名はスネークケースに変換
  "2nd_period_min" numeric,
  "3rd_period_min" numeric,
  created_at timestamptz,
  updated_at timestamptz,
  synced_at timestamptz DEFAULT now()
);
```

### プロパティ名 → カラム名の変換ルール

1. 小文字に変換
2. スペース、ハイフン、括弧を `_` に置換
3. 連続する `_` を1つに
4. 先頭・末尾の `_` を削除

例:
- `1st-period(min)` → `1st_period_min`
- `Date` → `date`
- `gcal_color_id` → `gcal_color_id`

---

## 同期ロジック

### マスター同期 (sync_type: "master")

```
1. Notion DBから全ページ取得
2. Supabase テーブルを TRUNCATE
3. 全データを INSERT
```

- 常に最新状態を反映
- 削除されたレコードも反映される
- データ量が多いと時間がかかる

### トランザクション同期 (sync_type: "transaction")

```
1. 前回同期日時を取得（last_synced_at）
2. Notion DBから last_edited_time > last_synced_at のページを取得
3. Supabase に UPSERT (ON CONFLICT id)
4. メタテーブルの last_synced_at を更新
```

- 差分のみ同期するため高速
- 削除されたレコードは検知できない（別途対応が必要）

---

## スキーマ同期 (sync_schema.ts)

Notionのプロパティ変更をSupabaseに反映するためのツール。

### 機能

1. メタテーブルから同期対象を取得
2. 各Notion DBのプロパティを取得
3. 現在のSupabaseテーブル構造と比較
4. 差分があればDDLを生成して表示
5. ユーザー確認後、apply_migration で適用

### 生成されるDDL例

```sql
-- 新規テーブル
CREATE TABLE notion.new_table (
  id text PRIMARY KEY,
  name text NOT NULL,
  ...
);

-- カラム追加
ALTER TABLE notion.existing_table
ADD COLUMN new_column text;

-- ※カラム削除は危険なため手動対応
-- 以下のカラムはNotionに存在しません: old_column
```

---

## API仕様

### 認証方式

Internal Integration Token（Bearer認証）

### 使用エンドポイント

| エンドポイント | 用途 |
|---------------|------|
| `POST /v1/databases/{id}/query` | ページ一覧取得 |
| `GET /v1/databases/{id}` | DB構造（プロパティ）取得 |

### ページネーション

- `page_size`: 最大100
- `has_more` + `next_cursor` で全件取得

### フィルター（トランザクション同期用）

```json
{
  "filter": {
    "timestamp": "last_edited_time",
    "last_edited_time": {
      "after": "2025-11-20T00:00:00Z"
    }
  }
}
```

---

## テスト

### 手動統合テスト

```bash
# メタテーブル読み込みテスト
deno run --allow-env --allow-net --allow-read fetch_config.ts

# 特定テーブルの同期テスト
NOTION_SYNC_DAYS=1 deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## GitHub Actions

定期実行は `sync-daily.yml` に統合（毎日 JST 09:00）。

個別実行は `sync-notion.yml` で手動トリガー可能。

---

## 初回セットアップ

### 1. Notion Integration 作成

1. [Notion Integrations](https://www.notion.so/my-integrations) にアクセス
2. "New integration" をクリック
3. 名前を入力（例: "Supabase Sync"）
4. Capabilities: "Read content" を有効化
5. "Submit" → Internal Integration Token をコピー

### 2. メタテーブル作成

Notionで `TB__METADATA` データベースを作成:

| プロパティ | 型 |
|-----------|-----|
| Name | Title |
| database_id | Text |
| supabase_table | Text |
| supabase_schema | Text |
| sync_type | Select (master / transaction) |
| enabled | Checkbox |
| last_synced_at | Text |
| description | Text |

### 3. Integration を接続

1. 各同期対象データベースを開く
2. 右上の「...」→「Connections」→ 作成したIntegrationを追加
3. メタテーブル（TB__METADATA）にも追加

### 4. 環境変数設定

```bash
NOTION_INTEGRATION_SECRET=secret_xxx
NOTION_METADATA_TABLE_ID=xxx  # TB__METADATA のID
```

### 5. スキーマ同期

```bash
deno run --allow-env --allow-net --allow-read sync_schema.ts
# 生成されたDDLを確認し、Supabaseで実行
```

### 6. 初回データ同期

```bash
deno run --allow-env --allow-net --allow-read sync_all.ts
```

---

## 制限事項・注意点

1. **削除の検知**: トランザクション同期では削除されたページを検知できない。必要なら定期的にマスター同期を実行。

2. **リレーション**: 関連ページのIDのみ保存。JOINには別途対応が必要。

3. **ファイル**: URLのみ保存。ファイル本体はダウンロードしない。

4. **フォーミュラ/ロールアップ**: 計算結果の型が変わる可能性あり。jsonbで保存が安全。

5. **レート制限**: Notion API は 3 requests/second。大量データ時は自動でスロットリング。
