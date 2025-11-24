# Toggl 同期モジュール

Toggl Track API から時間記録データを取得し、Supabase `toggl` スキーマに同期する。

## クイックスタート

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `TOGGL_API_TOKEN` | Yes | Toggl API Token |
| `TOGGL_WORKSPACE_ID` | Yes | Toggl Workspace ID |
| `TOGGL_SYNC_DAYS` | No | 同期日数（デフォルト: 3） |

### 実行コマンド

```bash
# 日次同期（直近3日間）- v9 API使用
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近7日間）
TOGGL_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（初回移行・リカバリ用）- Reports API v3使用
deno run --allow-env --allow-net --allow-read sync_all.ts

# 全件同期（特定期間）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2020-01-01 --end=2024-12-31

# メタデータのみ同期
deno run --allow-env --allow-net --allow-read sync_all.ts --metadata-only
```

---

## アーキテクチャ

### データパイプライン

```
Toggl API v9 (日次同期)           変換                      Supabase
───────────────────────────────────────────────────────────────────
/workspaces/{id}/clients  →  toDbClient()   →  toggl.clients
/workspaces/{id}/projects →  toDbProject()  →  toggl.projects
/workspaces/{id}/tags     →  toDbTag()      →  toggl.tags
/me/time_entries          →  toDbEntry()    →  toggl.entries

Reports API v3 (全件同期)         変換                           Supabase
─────────────────────────────────────────────────────────────────────────
/search/time_entries      →  reportsEntryToDbEntry()  →  toggl.entries
```

**APIの違い:**
| 項目 | v9 API | Reports API v3 |
|------|--------|----------------|
| 取得可能期間 | 過去3ヶ月 | 全期間 |
| duration | 秒 | ミリ秒 (dur) or 秒 (seconds) |
| 終了時刻 | stop | end |
| レート制限 | 緩い | 1req/sec + 時間クォータ |

**レート制限（Organization-specific requests）:**
| プラン | クォータ | 1時間で取得可能なエントリー数 |
|------|--------|---------------------------|
| Free | 30 req/hour | ~30,000 |
| Starter | 240 req/hour | ~240,000 |
| Premium | 600 req/hour | ~600,000 |

**レスポンスヘッダー:**
- `X-Toggl-Quota-Remaining`: 残りリクエスト数
- `X-Toggl-Quota-Resets-In`: リセットまでの秒数

**エラーコード:**
- 402: クォータ超過（リセットまで待機）
- 429: Too Many Requests（leaky bucket、数分待機）

### ファイル構成

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | 型定義（API・DB・同期結果） | No |
| `auth.ts` | Toggl API認証・HTTPリクエスト | No |
| `api.ts` | データ取得（v9 API + Reports API v3） | No |
| `write_db.ts` | DB書き込み（変換・upsert） | No |
| `fetch_data.ts` | データ取得オーケストレーション | No |
| `sync_daily.ts` | 日次同期（v9 API使用） | Yes |
| `sync_all.ts` | 全件同期（Reports API v3使用） | Yes |

---

## モジュール詳細

### types.ts

API型・DB型・同期結果型を定義。

```typescript
// Toggl API v9 レスポンス型
interface TogglApiV9Client {
  id: number;
  wid: number;
  name: string;
  archived: boolean;
  at: string;
}

interface TogglApiV9Project {
  id: number;
  workspace_id: number;
  client_id?: number | null;
  name: string;
  active: boolean;
  is_private: boolean;
  color: string;
  billable?: boolean;
  created_at: string;
  server_deleted_at?: string | null;
}

interface TogglApiV9Tag {
  id: number;
  workspace_id: number;
  name: string;
  at: string;
}

interface TogglApiV9TimeEntry {
  id: number;
  workspace_id: number;
  project_id?: number | null;
  user_id: number;
  description?: string;
  start: string;
  stop?: string | null;
  duration: number;        // 秒（実行中は負値）
  billable: boolean;
  tags?: string[];
  at: string;
}

// DB型
interface DbClient {
  id: number;
  workspace_id: number;
  name: string;
  is_archived: boolean;
  created_at: string;
}

interface DbProject {
  id: number;
  workspace_id: number;
  client_id: number | null;
  name: string;
  color: string | null;
  is_private: boolean;
  is_active: boolean;
  is_billable: boolean;
  created_at: string;
  archived_at: string | null;
}

interface DbTag {
  id: number;
  workspace_id: number;
  name: string;
  created_at: string;
}

interface DbEntry {
  id: number;
  workspace_id: number;
  project_id: number | null;
  user_id: number | null;
  description: string | null;
  start: string;
  end: string;
  duration_ms: number;    // ミリ秒
  is_billable: boolean;
  tags: string[];
  updated_at: string | null;
}

// 同期結果型
interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: { clients, projects, tags, entries };
  elapsedSeconds: number;
  error?: string;
}
```

### auth.ts

Toggl APIへの認証付きHTTPリクエスト。

```typescript
// 認証付きfetch
async function togglFetch<T>(endpoint: string): Promise<T>

// ワークスペースID
const workspaceId: string
```

認証方式: Basic認証（API Token + "api_token"）

リトライ: 500系エラーのみ（最大3回）、4xxエラーは即座にthrow

### api.ts

Toggl APIからのデータ取得。

```typescript
async function fetchClients(): Promise<TogglApiV9Client[]>
async function fetchProjects(): Promise<TogglApiV9Project[]>
async function fetchTags(): Promise<TogglApiV9Tag[]>
async function fetchEntries(days?: number): Promise<TogglApiV9TimeEntry[]>
async function fetchEntriesByRange(startDate: string, endDate: string): Promise<TogglApiV9TimeEntry[]>
async function fetchAllData(days?: number): Promise<TogglData>

// 日付範囲計算
function getDateRange(days: number): { start: string; end: string }
```

### write_db.ts

Supabase `toggl` スキーマへの書き込み。

```typescript
// 変換関数: API → DB
function toDbClient(client: TogglApiV9Client): DbClient
function toDbProject(project: TogglApiV9Project): DbProject
function toDbTag(tag: TogglApiV9Tag): DbTag
function toDbEntry(entry: TogglApiV9TimeEntry): DbEntry | null

// upsert
async function upsertClients(toggl, clients): Promise<number>
async function upsertProjects(toggl, projects): Promise<number>
async function upsertTags(toggl, tags): Promise<number>
async function upsertEntries(toggl, entries): Promise<number>
async function upsertMetadata(toggl, clients, projects, tags): Promise<{...}>
```

**変換時の重要な処理**:

| 変換 | 処理 |
|------|------|
| `toDbEntry` | `duration`秒 → `duration_ms`ミリ秒 |
| `toDbEntry` | `duration < 0`（実行中）→ `null`を返しスキップ |
| `toDbEntry` | `stop`がnull → `end = start` |
| `toDbProject` | `active` → `is_active` |
| `toDbProject` | `server_deleted_at` → `archived_at` |

### sync_daily.ts

日次同期オーケストレーター。

```typescript
async function syncTogglToSupabase(days?: number): Promise<SyncResult>
```

**同期フロー**:

1. `fetchAllData(days)` で全データ取得
2. `upsertMetadata()` でclients/projects/tagsを並列upsert
3. `upsertEntries()` でentriesをupsert（外部キー制約のため後）
4. `SyncResult`を返却

---

## データベーススキーマ

### toggl スキーマ

| テーブル | 主キー | 説明 |
|----------|--------|------|
| `clients` | `id` (bigint) | クライアント（Toggl ID） |
| `projects` | `id` (bigint) | プロジェクト（Toggl ID） |
| `tags` | `id` (bigint) | タグ（Toggl ID） |
| `entries` | `id` (bigint) | 時間記録（Toggl ID） |

### clients テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | bigint | PK, Toggl ID |
| workspace_id | bigint | |
| name | text | |
| is_archived | boolean | |
| created_at | timestamptz | |
| synced_at | timestamptz | 自動設定 |

### projects テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | bigint | PK, Toggl ID |
| workspace_id | bigint | |
| client_id | bigint | FK → clients.id |
| name | text | |
| color | text | |
| is_private | boolean | |
| is_active | boolean | |
| is_billable | boolean | |
| created_at | timestamptz | |
| archived_at | timestamptz | |
| synced_at | timestamptz | 自動設定 |

### tags テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | bigint | PK, Toggl ID |
| workspace_id | bigint | |
| name | text | |
| created_at | timestamptz | |
| synced_at | timestamptz | 自動設定 |

### entries テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | bigint | PK, Toggl ID |
| workspace_id | bigint | |
| project_id | bigint | FK → projects.id |
| task_id | bigint | |
| user_id | bigint | |
| description | text | |
| start | timestamptz | |
| end | timestamptz | |
| duration_ms | bigint | ミリ秒 |
| is_billable | boolean | |
| tags | text[] | |
| updated_at | timestamptz | |
| synced_at | timestamptz | 自動設定 |

---

## API仕様

### 認証方式

Basic認証（API Token）。トークンは環境変数から取得。

### エンドポイント

| エンドポイント | 説明 |
|---------------|------|
| `/api/v9/workspaces/{id}/clients` | クライアント一覧 |
| `/api/v9/workspaces/{id}/projects` | プロジェクト一覧 |
| `/api/v9/workspaces/{id}/tags` | タグ一覧 |
| `/api/v9/me/time_entries` | 時間記録（日付範囲指定可） |

### 制約・制限

| 項目 | 値 |
|------|-----|
| レート制限 | 無料プラン: 制限あり（詳細不明） |
| time_entries取得 | start_date/end_date パラメータ必須 |
| エラーコード | 402: レート制限超過 |

---

## 日付範囲の計算パターン

全サービス共通パターン (`api.ts` の `getDateRange` 関数):

```typescript
// endDate = 明日（APIは排他的終点のため）
const end = new Date();
end.setDate(end.getDate() + 1);

// startDate = endDate - (days + 1)
const start = new Date(end);
start.setDate(start.getDate() - days - 1);
```

このパターンにより `days日前から今日まで` のデータを確実に取得。

---

## テスト

### 手動統合テスト

```bash
# 日次同期テスト（1日間）
TOGGL_SYNC_DAYS=1 deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## GitHub Actions

定期実行は `sync-all.yml` に統合（毎日 JST 00:00）。

個別実行は `sync-toggl.yml` で手動トリガー可能。

---

## 初回セットアップ

1. [Toggl Track](https://track.toggl.com/) でアカウント作成

2. Profile → API Token からトークンを取得

3. ワークスペースIDを確認（URLから取得可能）

4. 環境変数を設定

5. 初回同期を実行:
   ```bash
   TOGGL_SYNC_DAYS=365 deno run --allow-env --allow-net --allow-read sync_daily.ts
   ```

---

## パフォーマンス最適化

本モジュールでは以下の最適化を実施済み:

- メタデータ（clients/projects/tags）の並列取得
- API呼び出しのstaggered delay（200ms/400ms/600ms）
- Supabaseへのupsertの並列化
- バッチサイズ1000でのupsert

---

## DWH移行計画

### 概要

現在の `toggl` スキーマを `raw` スキーマに移行し、DWH 3層アーキテクチャを採用する。

```
現在:  toggl.entries, toggl.projects, toggl.clients, toggl.tags
    ↓
移行後:
  raw.toggl_entries      ← 生データ（テーブル）
  raw.toggl_projects
  raw.toggl_clients
  raw.toggl_tags
      ↓
  staging.stg_toggl__entries   ← クリーニング済み（ビュー）
  staging.stg_toggl__projects
      ↓
  marts.fct_time_entries       ← ビジネスエンティティ（ビュー）
  marts.dim_projects
```

### 変更点

| 項目 | 現在 | 移行後 |
|------|------|--------|
| スキーマ | `toggl` | `raw` |
| テーブル名 | `entries` | `toggl_entries` |
| DBクライアント | supabase-js (REST API) | postgres.js (直接接続) |
| API公開 | Exposed | Not Exposed |

### write_db.ts 変更内容

```typescript
// 現在
import { createClient } from "npm:@supabase/supabase-js@2";
const supabase = createClient(url, key);
const toggl = supabase.schema("toggl");
await toggl.from("entries").upsert(data);

// 移行後
import postgres from "npm:postgres";
const sql = postgres(DATABASE_URL);
await sql`
  INSERT INTO raw.toggl_entries ${sql(records)}
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    start = EXCLUDED.start,
    "end" = EXCLUDED."end",
    duration_ms = EXCLUDED.duration_ms,
    updated_at = EXCLUDED.updated_at,
    synced_at = now()
`;
```

### 環境変数追加

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | PostgreSQL 直接接続文字列 |

### マイグレーション手順

1. `raw.toggl_*` テーブルを作成
2. `toggl.*` から `raw.toggl_*` にデータ移行
3. `write_db.ts` を postgres.js に書き換え
4. `staging.stg_toggl__*` ビューを作成
5. 旧 `toggl` スキーマを削除（データ確認後）
