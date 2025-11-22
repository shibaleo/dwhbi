# Toggl同期モジュール

Toggl Track APIからデータを取得し、Supabaseの`toggl`スキーマに同期するモジュール群。

## データパイプライン

```
Toggl API                    変換                      Supabase
───────────────────────────────────────────────────────────────────
/workspaces/{id}/clients  →  toDbClient()   →  toggl.clients
/workspaces/{id}/projects →  toDbProject()  →  toggl.projects
/workspaces/{id}/tags     →  toDbTag()      →  toggl.tags
/me/time_entries          →  toDbEntry()    →  toggl.entries
```

## ファイル構成

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | 型定義（API・DB・同期結果） | No |
| `client.ts` | Toggl API認証・HTTPリクエスト | No |
| `api.ts` | データ取得 | No |
| `write_db.ts` | DB書き込み（変換・upsert） | No |
| `sync_daily.ts` | 日次同期オーケストレーター | Yes |

---

## モジュール境界

### types.ts

#### Toggl API レスポンス型

```typescript
interface TogglApiV9Client {
  id: number;
  wid: number;              // workspace_id
  name: string;
  archived: boolean;
  at: string;               // 更新日時（ISO 8601）
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
  // 他オプショナルフィールド省略
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
  task_id?: number | null;
  user_id: number;
  description?: string;
  start: string;            // ISO 8601
  stop?: string | null;     // 実行中はnull
  duration: number;         // 秒（実行中は負値）
  billable: boolean;
  tags?: string[];
  at: string;               // 更新日時
}
```

#### DB テーブル型

```typescript
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
  // 他フィールド省略（estimated_hours, rate, currency等）
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
  task_id: number | null;
  user_id: number | null;
  description: string | null;
  start: string;
  end: string;
  duration_ms: number;      // ミリ秒
  is_billable: boolean;
  tags: string[];
  updated_at: string | null;
}
```

#### 同期結果型

```typescript
interface SyncStats {
  clients: number;
  projects: number;
  tags: number;
  entries: number;
}

interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  elapsedSeconds: number;
  error?: string;
}
```

---

### client.ts

Toggl APIへの認証付きHTTPリクエスト。

```typescript
export async function togglFetch<T>(endpoint: string): Promise<T>
export const workspaceId: string
```

- 認証: Basic認証（環境変数から取得）
- リトライ: 500系エラーのみ（最大3回）
- 4xxエラー: 即座にthrow

---

### api.ts

Toggl APIからのデータ取得。

```typescript
export async function fetchClients(): Promise<TogglApiV9Client[]>
export async function fetchProjects(): Promise<TogglApiV9Project[]>
export async function fetchTags(): Promise<TogglApiV9Tag[]>
export async function fetchEntries(days?: number): Promise<TogglApiV9TimeEntry[]>
export async function fetchEntriesByRange(startDate: string, endDate: string): Promise<TogglApiV9TimeEntry[]>
export async function fetchAllData(days?: number): Promise<TogglData>
```

#### TogglData（fetchAllDataの出力）

```typescript
interface TogglData {
  clients: TogglApiV9Client[];
  projects: TogglApiV9Project[];
  tags: TogglApiV9Tag[];
  entries: TogglApiV9TimeEntry[];
}
```

---

### write_db.ts

Supabase togglスキーマへの書き込み。

```typescript
// クライアント作成
export function createTogglClient(): TogglSchema

// 変換関数
export function toDbClient(client: TogglApiV9Client): DbClient
export function toDbProject(project: TogglApiV9Project): DbProject
export function toDbTag(tag: TogglApiV9Tag): DbTag
export function toDbEntry(entry: TogglApiV9TimeEntry): DbEntry | null

// upsert
export async function upsertClients(toggl, clients): Promise<number>
export async function upsertProjects(toggl, projects): Promise<number>
export async function upsertTags(toggl, tags): Promise<number>
export async function upsertEntries(toggl, entries): Promise<number>
export async function upsertMetadata(toggl, clients, projects, tags): Promise<{clients, projects, tags}>
```

#### 変換時の重要な処理

| 変換 | 処理 |
|------|------|
| `toDbEntry` | `duration`秒 → `duration_ms`ミリ秒 |
| `toDbEntry` | `duration < 0`（実行中）→ `null`を返しスキップ |
| `toDbEntry` | `stop`がnull → `end = start` |
| `toDbProject` | `active` → `is_active` |
| `toDbProject` | `server_deleted_at` → `archived_at` |

---

### sync_daily.ts

日次同期オーケストレーター。

```typescript
export async function syncTogglToSupabase(days?: number): Promise<SyncResult>
```

#### 同期フロー

1. `fetchAllData(days)` で全データ取得
2. `upsertMetadata()` でclients/projects/tagsを並列upsert
3. `upsertEntries()` でentriesをupsert（外部キー制約のため後）
4. `SyncResult`を返却

---

## DBスキーマ

### toggl.clients

| カラム | 型 | 説明 |
|--------|------|------|
| id | bigint | PK, Toggl ID |
| workspace_id | bigint | |
| name | text | |
| is_archived | boolean | |
| created_at | timestamptz | |
| synced_at | timestamptz | 自動設定 |

### toggl.projects

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

### toggl.tags

| カラム | 型 | 説明 |
|--------|------|------|
| id | bigint | PK, Toggl ID |
| workspace_id | bigint | |
| name | text | |
| created_at | timestamptz | |
| synced_at | timestamptz | 自動設定 |

### toggl.entries

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

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `TOGGL_API_TOKEN` | Yes | Toggl API Token |
| `TOGGL_WORKSPACE_ID` | Yes | Toggl Workspace ID |
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `TOGGL_SYNC_DAYS` | No | 同期日数（デフォルト: 3） |

---

## 日付範囲の計算パターン

全サービス共通の日付範囲計算パターン (`api.ts` の `getDateRange` 関数):

```typescript
// endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
const end = new Date();
end.setDate(end.getDate() + 1);

// startDate = endDate - (days + 1)
const start = new Date(end);
start.setDate(start.getDate() - days - 1);
```

このパターンにより `days日前から今日まで` のデータを確実に取得できます。

---

## 実行

```bash
# 直近1日分を同期
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 直近7日分を同期
TOGGL_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## GitHub Actions

`.github/workflows/sync-toggl.yml` で毎日 JST 00:00 に自動実行。
