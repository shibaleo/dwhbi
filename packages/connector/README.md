# @repo/connector

データ収集パイプライン（外部API → raw層）

Node.js/TypeScript で実装。PostgreSQL Vault 拡張を使用した認証情報管理。

## 構成

```
connector/
├── src/
│   ├── services/              # サービス別同期モジュール
│   │   ├── toggl-track/
│   │   └── google-calendar/
│   ├── lib/                   # 共通ライブラリ
│   ├── db/                    # DB操作
│   └── index.ts
├── package.json
└── .env
```

### サービス共通構造

各サービスは以下の構造で実装:

```
services/{service}/
├── api-client.ts       # API通信・認証（キャッシュ付き）
├── orchestrator.ts     # 同期オーケストレーター（DB接続管理）
├── sync-masters.ts     # マスタデータ同期
├── sync-{data}.ts      # トランザクションデータ同期
├── cli.ts              # CLIエントリポイント
└── index.ts            # エクスポート
```

**処理フロー:**
```
cli.ts → orchestrator.syncAll()
           ├── getDbClient()      # DB接続（1回）
           ├── syncMasters()      # マスタ同期
           ├── syncData(days)     # データ同期
           └── closeDbClient()    # DB切断
```

## セットアップ

```bash
# 依存関係インストール（ルートから）
npm install

# 環境変数設定
cp .env.example .env
# .env を編集
```

### 必要な環境変数

```env
DIRECT_DATABASE_URL="postgresql://[user]:[password]@host:[port]/[dbname]"
```

例
```env
DIRECT_DATABASE_URL="postgresql://postgres:XXXYYYZZZ@host:5432/postgres"
```

> **Note**: Supabase 以外の PostgreSQL でも動作します（Vault 拡張が必要）。

## 使用方法

### CLI

```bash
# Toggl Track 同期（デフォルト3日分）
npm run sync:toggl

# Google Calendar 同期（1日分）
npm run sync:gcal -- --days 1

# npx で直接実行
npx tsx src/services/toggl-track/cli.ts --days 7
npx tsx src/services/google-calendar/cli.ts --days 3
```

### ライブラリとして使用

```typescript
import { syncAll as syncToggl } from "@repo/connector/toggl-track";
import { syncAll as syncGcal } from "@repo/connector/google-calendar";

// Toggl データを3日分同期
const togglResult = await syncToggl(3);
console.log(`Synced ${togglResult.timeEntriesCount} time entries`);

// Google Calendar を1日分同期
const gcalResult = await syncGcal(1);
console.log(`Synced ${gcalResult.eventsCount} events`);
```

## テスト

```bash
# 全テスト実行
npm test

# 一度だけ実行
npm run test:run

# 型チェック
npm run typecheck
```

## 認証情報の管理

認証情報は **PostgreSQL Vault 拡張** (`vault.secrets` テーブル) に保存されます。
Vault は DB 内蔵の暗号化を使用するため、アプリケーション側での暗号化キー管理は不要です。

```sql
-- vault.secrets（Vault拡張が自動管理）
-- decrypted_secrets ビューで復号化されたデータを取得
SELECT name, decrypted_secret FROM vault.decrypted_secrets;
```

### 認証情報のフォーマット（JSON）

```json
// toggl_track
{
  "api_token": "xxxxx",
  "workspace_id": 12345,
  "_auth_type": "api_key"
}

// google_calendar
{
  "client_id": "xxxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxxxx",
  "refresh_token": "1//xxxxx",
  "access_token": "ya29.xxxxx",
  "_auth_type": "oauth2",
  "_expires_at": "2024-01-01T00:00:00.000Z"
}
```

## 対応サービス

| サービス | 認証方式 | raw テーブル |
|---------|---------|-------------|
| Toggl Track | API Token | `raw.toggl_track__*` (me, workspaces, clients, projects, tags, users, time_entries) |
| Google Calendar | OAuth 2.0 | `raw.google_calendar__*` (colors, calendars, calendar_list, events) |

## 新サービスの追加

1. `src/services/{service}/` を作成（既存サービスをコピー）
2. `api-client.ts` で認証・API呼び出しを実装
3. `sync-*.ts` で `upsertRaw()` を使ってデータ保存
4. `orchestrator.ts` で `getDbClient()` / `closeDbClient()` を呼び出し
5. `package.json` の `exports` に追加
6. Vault に認証情報を登録

詳細は [設計ドキュメント](/100-development/130-design/) を参照。

## トラブルシューティング

### `Error: DIRECT_DATABASE_URL environment variable is required`

`.env` ファイルに `DIRECT_DATABASE_URL` を設定してください。
Supabase Vault へのアクセスには直接接続が必要です。

### `Error: Credentials not found for service: toggl_track`

Supabase Vault に認証情報が登録されていません。
管理コンソールまたは SQL で登録してください:

```sql
SELECT vault.create_secret(
  '{"api_token": "your_token", "workspace_id": 12345, "_auth_type": "api_key"}',
  'toggl_track',
  'Toggl Track credentials'
);
```

### `HTTP 401: Unauthorized`

API トークンが無効です。Vault 内の認証情報を確認・更新してください。

### `Token refresh error: 400`

Google OAuth のリフレッシュトークンが失効しています。
管理コンソールから再認証してください。
