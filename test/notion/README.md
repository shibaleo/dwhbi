# Notion テスト

## ディレクトリ構成

```
test/notion/
├── README.md              # このファイル
├── type_mapping.test.ts   # propertyNameToColumn, notionTypeToPostgres
├── check_api.ts           # API疎通確認
├── check_config.ts        # メタテーブル読み込み確認
├── check_sync.ts          # 同期確認（⚠️ DB書き込みあり）
└── check_all.ts           # 一括確認
```

## 単体テスト（`*.test.ts`）

環境変数不要で実行可能。

```bash
# deno task を使用（推奨）
deno task test:notion

# または直接実行
deno test test/notion/ --allow-env --allow-read
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `type_mapping.test.ts` | 22件 | `propertyNameToColumn` (10件), `notionTypeToPostgres` (12件) |
| **合計** | **22件** | |

### テスト観点

#### type_mapping.test.ts
- `propertyNameToColumn`: プロパティ名 → カラム名変換（スネークケース）
  - スペース、ハイフン、括弧の変換
  - 連続する `_` の削除
  - 先頭・末尾の `_` 削除
- `notionTypeToPostgres`: Notion型 → PostgreSQL型マッピング
  - 基本型（title, rich_text, number等）
  - JSONB型（date, rollup, formula等）
  - 配列型（multi_select, people等）

## 手動確認スクリプト（`check_*.ts`）

実環境のAPI・DBに接続するため、環境変数が必要。

### 必要な環境変数

```bash
# Notion API
NOTION_INTEGRATION_SECRET=secret_xxxxx
NOTION_METADATA_TABLE_ID=xxxxx

# Supabase API
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx

# オプション環境変数
NOTION_DISCOVER_DATABASES=false  # データベース自動検出
NOTION_SKIP_SCHEMA_SYNC=true  # スキーマ同期をスキップ（高速化）
DEBUG=false  # 詳細ログ表示

# データベース接続（テーブル自動作成に必要、オプション）
# 以下のいずれかを設定：
# オプション1: SUPABASE_URLとパスワード（推奨）
SUPABASE_DB_PASSWORD=xxxxx

# オプション2: プロジェクトIDとパスワード
SUPABASE_PROJECT_ID=xxxxx
DB_PASSWORD=xxxxx

# オプション3: 接続文字列を直接指定
SUPABASE_DB_URL=postgresql://postgres.[PROJECT_ID]:[PASSWORD]@[REGION].pooler.supabase.com:5432/postgres
```

### 推奨実行順序

```bash
# 1. API疎通確認
deno run --allow-env --allow-net --allow-read test/notion/check_api.ts

# 2. メタテーブル読み込み確認
deno run --allow-env --allow-net --allow-read test/notion/check_config.ts

# 3. 同期確認（⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/notion/check_sync.ts

# または一括実行
deno task check:notion
deno task check:notion:sync  # DB書き込みあり
```

## データベース自動検出（sync_dailyに統合済）

Notionワークスペース内の全データベースを検索し、TB__METADATAに自動登録します。

```bash
# 方法1: 同期時に自動検出（推奨）
NOTION_DISCOVER_DATABASES=true deno task sync:notion

# 方法2: 検出のみ実行（単体実行）
deno task notion:discover
```

### 動作

1. Notionワークスペース内の全データベースを検索
2. TB__METADATAに未登録のデータベースを検出
3. 新規データベースを `enabled=false` で自動追加
4. 追加されたデータベースをログに表示

**注意:**
- `NOTION_DISCOVER_DATABASES=true` を設定すると、`sync_daily.ts` 実行時に自動検出が実行されます
- デフォルトでは無効（レート制限回避のため）
- 初回セットアップ時は単体実行（`deno task notion:discover`）を推奨

### 次のステップ

新しいデータベースが追加された場合：

1. Notionで `TB__METADATA` を開く
2. 同期したいデータベースについて：
   - `supabase_table`: テーブル名を設定（**必須**）
   - `supabase_schema`: スキーマ名を設定（デフォルト: notion）
   - `sync_type`: **master** または **transaction** を選択（**必須**）
   - `enabled`: チェックを入れて有効化
3. 同期を実行: `deno task sync:notion`

**注意:** `supabase_table` と `sync_type` が未設定のデータベースは自動的にスキップされます。

## テーブル自動作成

同期時に自動的にテーブルを作成します。以下の環境変数が必要です：

```bash
# オプション1: SUPABASE_URLとパスワードで自動構築（推奨）
SUPABASE_URL="https://xxxxx.supabase.co"  # 既に設定済みのはず
SUPABASE_DB_PASSWORD="xxxxx"              # 追加が必要

# オプション2: プロジェクトIDとパスワードで自動構築
SUPABASE_PROJECT_ID="xxxxx"
DB_PASSWORD="xxxxx"  # または SUPABASE_DB_PASSWORD

# オプション3: 接続文字列を直接指定
SUPABASE_DB_URL="postgresql://postgres.[PROJECT_ID]:[PASSWORD]@[REGION].pooler.supabase.com:5432/postgres"

# リージョン（オプショナル、デフォルト: aws-1-ap-northeast-1）
SUPABASE_REGION="aws-1-ap-northeast-1"
```

### 既存の環境変数がある場合

既に `SUPABASE_URL` と `DB_PASSWORD` が設定されている場合：

```bash
# .env に追加（既存の DB_PASSWORD を参照）
SUPABASE_DB_PASSWORD="${DB_PASSWORD}"
```

または、コードが自動的に `DB_PASSWORD` を `SUPABASE_DB_PASSWORD` として使用するため、
何も追加しなくても動作します。

### 動作

1. 同期開始時に全テーブルの存在を確認
2. 不足しているテーブルを自動作成
3. 新しいカラムがあれば自動追加
4. データ同期を実行

### 環境変数がない場合

DB接続情報が設定されていない場合：
- 警告メッセージが表示されます
- テーブルが存在しない場合、書き込みは失敗しますが同期は継続されます
- 手動でDDLを実行する必要があります

### 手動でテーブルを作成する場合

```bash
# DDLを生成
deno run --allow-env --allow-net --allow-read src/services/notion/sync_schema.ts --output schema.sql

# 生成されたDDLをSupabase Dashboardで実行
```

## レート制限

- Notion API: 3 requests/second
- 大量データ取得時は自動的に待機

## トラブルシューティング

### レート制限

```
❌ エラー: 429 Too Many Requests
```

→ 60秒待つか、しばらく時間をおいて再実行。

### 認証エラー

```
❌ エラー: 401 Unauthorized
```

→ NOTION_INTEGRATION_SECRET が正しいか確認。

### メタテーブルが見つからない

```
❌ エラー: database not found
```

→ NOTION_METADATA_TABLE_ID が正しいか確認。
→ Integration が TB__METADATA に接続されているか確認。

### テーブルが存在しない

```
[ERROR] gcal_mapping delete failed: Could not find the table 'notion.gcal_mapping' in the schema cache
```

→ データベース接続情報が設定されていれば、同期時に自動でテーブルが作成されます。
→ 以下のいずれかを`.env`に設定してください：
   - `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`（推奨）
   - `SUPABASE_PROJECT_ID` + `DB_PASSWORD`
   - `SUPABASE_DB_URL`（直接指定）
→ 環境変数を設定しない場合は、`sync_schema.ts`でDDLを生成して手動実行してください。

### データベース接続エラー

```
[ERROR] Database connection configuration missing
```

→ テーブル自動作成に必要な環境変数が設定されていません。
→ 以下のいずれかを設定してください：
   - `SUPABASE_URL`（既存） + `SUPABASE_DB_PASSWORD`
   - `SUPABASE_PROJECT_ID` + `DB_PASSWORD`
   - `SUPABASE_DB_URL`

## メタテーブル（TB__METADATA）セットアップ

1. Notionで `TB__METADATA` データベースを作成
2. 以下のプロパティを追加:
   - Name (Title)
   - database_id (Text)
   - supabase_table (Text)
   - supabase_schema (Text)
   - sync_type (Select: master / transaction)
   - enabled (Checkbox)
   - last_synced_at (Text)
   - description (Text)

3. Integration を接続
4. `NOTION_METADATA_TABLE_ID` にデータベースIDを設定
