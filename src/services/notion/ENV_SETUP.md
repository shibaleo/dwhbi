# Notion同期の環境変数設定

## 必須の環境変数

```bash
# Notion Integration Secret（Notion Integrations pageから取得）
NOTION_INTEGRATION_SECRET="secret_xxxxx"

# メタテーブルのDatabase ID（TB__METADATAのDatabase ID）
NOTION_METADATA_TABLE_ID="xxxxx"

# Supabase接続情報
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="xxxxx"

# データベースパスワード（Supabase Dashboard > Settings > Database > Database Passwordから取得）
SUPABASE_DB_PASSWORD="xxxxx"

# リージョン（オプショナル、デフォルト: aws-1-ap-northeast-1）
SUPABASE_REGION="aws-1-ap-northeast-1"
```

## 設定の取得方法

### SUPABASE_URL
既に設定されているはずです。形式: `https://[PROJECT_ID].supabase.co`

### SUPABASE_DB_PASSWORD
1. Supabase Dashboard > Settings > Database
2. Database Passwordセクションを確認
3. パスワードをコピー（既存のプロジェクトの場合、既に`DB_PASSWORD`として設定されている可能性があります）

### SUPABASE_REGION
自動検出されますが、明示的に指定することもできます：
- `aws-1-ap-northeast-1` (東京)
- `aws-0-us-east-1` (バージニア)
- `aws-0-us-west-1` (カリフォルニア)
- `aws-0-eu-west-1` (アイルランド)

## 代替設定方法

### 方法1: プロジェクトIDを直接指定

```bash
SUPABASE_PROJECT_ID="xxxxx"
DB_PASSWORD="xxxxx"  # または SUPABASE_DB_PASSWORD
```

### 方法2: 接続文字列を直接指定（上級者向け）

```bash
# Session Pooler URI（推奨）
SUPABASE_DB_URL="postgresql://postgres.[PROJECT_ID]:[PASSWORD]@[REGION].pooler.supabase.com:5432/postgres"

# または Direct connection
SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_ID].supabase.co:5432/postgres"
```

### 優先順位

1. `SUPABASE_DB_URL`（直接指定）
2. `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`（推奨）
3. `SUPABASE_PROJECT_ID` + `DB_PASSWORD`

いずれかが設定されていれば、自動でテーブル作成が有効になります。

## 自動テーブル作成の仕組み

`SUPABASE_PROJECT_ID` + `DB_PASSWORD` または `SUPABASE_DB_URL` が設定されている場合：
- 同期時に自動でテーブルの存在をチェック
- 不足しているテーブルを自動作成
- 新しいカラムを自動追加
- スキーマ変更後にデータ同期を実行

DB接続情報が設定されていない場合：
- 警告が表示される
- テーブルが存在しない場合は書き込みエラーが発生
- 手動でDDLを生成・実行する必要がある

## セキュリティ上の注意

- `DB_PASSWORD`と`SUPABASE_DB_URL`にはデータベースパスワードが含まれるため、`.env`ファイルは絶対にGitにコミットしないでください
- `.gitignore`に`.env`が含まれていることを確認してください
