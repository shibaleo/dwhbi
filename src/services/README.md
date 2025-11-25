# Services

外部APIからデータを取得し、Supabaseに同期するモジュール群。

## サービス一覧

| サービス | データソース | 同期先スキーマ | 概要 |
|----------|-------------|---------------|------|
| [fitbit](./fitbit/) | Fitbit Web API | `fitbit` | 睡眠・心拍・活動・HRV・SpO2等のヘルスデータ |
| [gcalendar](./gcalendar/) | Google Calendar API | `gcalendar` | 予定イベント（Togglとの予実管理用） |
| [tanita](./tanita/) | Tanita Health Planet API | `tanita` | 体組成・血圧・歩数 |
| [toggl](./toggl/) | Toggl Track API | `toggl` | 時間記録（実績） |
| [zaim](./zaim/) | Zaim API | `zaim` | 家計簿（収支・口座） |

---

## 共通アーキテクチャ

### ファイル構成

各サービスは同一のファイル構成に従う:

```
{service}/
├── types.ts        # 型定義（API・DB・同期関連）
├── auth.ts         # 認証（OAuth/Basic/JWT）
├── api.ts          # APIクライアント
├── fetch_data.ts   # データ取得オーケストレーション
├── write_db.ts     # DB書き込み（変換・upsert）
├── sync_daily.ts   # 日次同期（GitHub Actions用）
├── sync_all.ts     # 全件同期（初回移行・リカバリ用）
└── README.md       # サービス固有ドキュメント
```

### データフロー

```
┌─────────────────────────────────────────────────────────────────┐
│  sync_daily.ts / sync_all.ts（オーケストレーター）              │
│    - 同期日数/期間の決定                                        │
│    - OAuth 2.0系: トークン確認（ensureValidToken）              │
│    - エラーハンドリング・ログ出力                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  fetch_data.ts（データ取得層）                                  │
│    - 日付範囲計算                                               │
│    - API制約の吸収（チャンク分割、レート制限対応）              │
│    - api.tsを呼び出してデータ取得                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  api.ts（APIクライアント層）                                    │
│    - 外部APIへのリクエスト                                      │
│    - auth.tsから認証情報取得                                    │
│    - レスポンスのパース                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  write_db.ts（DB書き込み層）                                    │
│    - API型 → DB型への変換（toDb{Entity}）                       │
│    - バッチupsert処理                                           │
│    - 結果集計                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 共通環境変数

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `SUPABASE_URL` | Supabase プロジェクトURL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | ✅ |
| `TOKEN_ENCRYPTION_KEY` | トークン暗号化キー（32バイト以上） | ✅ |

> **Note**: 各サービスの認証情報は `credentials.services` テーブルに暗号化して保存されています。

---

## 実装方針

データパイプライン順に記載: `types` → `auth` → `api` → `fetch_data` → `write_db` → `sync_daily` → `sync_all`

---

### 1. types.ts

**責務:** 型定義の一元管理（API型、DB型、同期関連型、エラー型）

#### セクション順序

```typescript
/**
 * {Service} 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

import { RateLimitError } from "../../utils/errors.ts";

// =============================================================================
// Error Types
// =============================================================================

// =============================================================================
// {Service} API Response Types
// =============================================================================

// =============================================================================
// Auth Types
// =============================================================================

// =============================================================================
// Database Table Types ({service} schema)
// =============================================================================

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

// =============================================================================
// Sync Result Types
// =============================================================================

// =============================================================================
// Constants（サービス固有の定数がある場合のみ）
// =============================================================================

// =============================================================================
// Type Aliases (後方互換性のため)
// =============================================================================
```

#### 命名規則

| 種別 | 形式 | 例 |
|------|------|-----|
| APIレスポンス型 | `{Service}Api{Entity}` | `FitbitApiSleepResponse`, `TogglApiTimeEntry` |
| DBテーブル型 | `Db{Entity}` | `DbSleep`, `DbEntry` |
| 取得データ型 | `{Service}Data` | `FitbitData`, `TogglData` |
| 同期統計型 | `SyncStats` | - |
| 同期結果型 | `SyncResult` | - |

#### エラークラス

types.ts に定義し、`utils/errors.ts` の基底クラスを継承:

| サービス | エラークラス | 継承元 | HTTPステータス |
|----------|-------------|--------|----------------|
| fitbit | `FitbitRateLimitError` | `RateLimitError` | 429 |
| toggl | `ReportsApiQuotaError` | `QuotaExceededError` | 402 |
| toggl | `ReportsApiRateLimitError` | `RateLimitError` | 429 |
| zaim | `ZaimRateLimitError` | `RateLimitError` | 429 |

```typescript
export class FitbitRateLimitError extends RateLimitError {
  constructor(retryAfterSeconds: number, message?: string) {
    super(retryAfterSeconds, message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`);
    this.name = "FitbitRateLimitError";
  }
}
```

#### SyncResult / SyncStats

```typescript
interface SyncResult {
  success: boolean;
  timestamp: string;      // ISO8601
  stats: SyncStats;       // サービス固有
  errors: string[];
  elapsedSeconds: number;
}
```

#### 後方互換性

```typescript
/** @deprecated Use FitbitApiSleepLog instead */
export type SleepLog = FitbitApiSleepLog;
```

---

### 2. auth.ts

**責務:** 認証情報の取得・管理（OAuth 2.0トークン管理、Basic Auth、JWT生成）

#### パターン一覧

| パターン | サービス | 認証方式 | トークン管理 | DB使用 |
|----------|----------|----------|--------------|--------|
| A | fitbit, tanita | OAuth 2.0 | Supabase DB | ✅ |
| B | gcalendar | Service Account (JWT) | メモリキャッシュ | ❌ |
| C | toggl, zaim | Basic Auth / OAuth 1.0a | 環境変数 | ❌ |

#### パターンA: OAuth 2.0（fitbit, tanita）

```typescript
// 主要エクスポート
export async function ensureValidToken(options?: AuthOptions): Promise<string>
export function isTokenExpiringSoon(expiresAt: Date, threshold: number): boolean
export async function getTokenFromDb(supabase: SupabaseClient): Promise<DbToken | null>
export async function saveTokenToDb(supabase: SupabaseClient, token: Partial<DbToken>): Promise<void>
export async function refreshTokenFromApi(refreshToken: string): Promise<TokenResponse>
```

sync_daily.tsからの呼び出し:

```typescript
const accessToken = await ensureValidToken(); // DBへのトークン保存が副作用
```

#### パターンB: Service Account（gcalendar）

```typescript
export async function getAccessToken(): Promise<string>
export async function authenticatedFetch(url: string, options?: RequestInit): Promise<Response>
```

#### パターンC: Basic Auth / OAuth 1.0a（toggl, zaim）

```typescript
// toggl
export async function togglFetch<T>(endpoint: string): Promise<T>
export const workspaceId: number

// zaim
export class ZaimOAuth {
  async get<T>(url: string): Promise<T>
  async post<T>(url: string, body: object): Promise<T>
}
```

#### 環境変数

全サービス共通で以下の環境変数のみ必要:

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |
| `TOKEN_ENCRYPTION_KEY` | トークン暗号化キー（32バイト以上） |

> **Note**: 各サービスの認証情報（APIトークン、OAuth credentials等）は
> `credentials.services` テーブルに暗号化して保存されています。

---

### 3. api.ts

**責務:** 外部APIへのHTTPリクエスト実行

#### セクション順序

```typescript
/**
 * {Service} API クライアント
 */

import { ... } from "./auth.ts";
import { type ..., {Service}RateLimitError } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = "https://api.example.com";

// =============================================================================
// Helper Functions
// =============================================================================

export function format{Service}Date(date: Date): string { ... }

// =============================================================================
// Re-export (後方互換)
// =============================================================================

export { FitbitRateLimitError } from "./types.ts";

// =============================================================================
// API Client / Functions
// =============================================================================
```

#### 実装スタイル

| スタイル | サービス | 認証方式 |
|----------|----------|----------|
| クラスベース | fitbit, tanita, zaim | OAuth 2.0, OAuth 1.0a |
| 関数ベース | gcalendar, toggl | Service Account, Basic Auth |

クラスベース:

```typescript
export class FitbitAPI {
  constructor(private accessToken: string) {}
  
  async getSleepByDateRange(start: Date, end: Date): Promise<FitbitApiSleepResponse> {
    return this.request(`/1.2/user/-/sleep/date/${formatFitbitDate(start)}/${formatFitbitDate(end)}.json`);
  }
}
```

関数ベース:

```typescript
export async function fetchClients(): Promise<TogglApiClient[]> {
  return togglFetch(`/workspaces/${workspaceId}/clients`);
}
```

#### 日付フォーマット関数

| サービス | 関数 | 形式 |
|----------|------|------|
| fitbit | `formatFitbitDate()` | YYYY-MM-DD |
| tanita | `formatTanitaDate()` | YYYYMMDDHHmmss |
| toggl | `formatTogglDate()` | YYYY-MM-DD |

---

### 4. fetch_data.ts

**責務:** データ取得のオーケストレーション（日付範囲計算、チャンク分割、レート制限対応）

#### セクション順序

```typescript
/**
 * {Service} データ取得
 */

import { ... } from "./api.ts";
import type { FetchOptions, {Service}Data } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const CHUNK_SIZE_MONTHS = 12;

// =============================================================================
// Helper Functions
// =============================================================================

// =============================================================================
// Data Fetch (日次同期用)
// =============================================================================

export async function fetch{Service}DataByDays(days: number): Promise<{Service}Data>

// =============================================================================
// Data Fetch (全件同期用)
// =============================================================================

export async function fetch{Service}Data(options: FetchOptions): Promise<{Service}Data>
```

#### 責務詳細

1. **日付範囲計算**: sync_daily/sync_allから日数/期間を受け取り、具体的な日付範囲を算出
2. **チャンク分割**: API制約に応じて長期間リクエストを分割
3. **レート制限対応**: エラー時の待機・リトライ
4. **進捗報告**: コールバック経由（任意）

#### 日付範囲計算パターン

```typescript
export async function fetch{Service}DataByDays(days: number): Promise<{Service}Data> {
  // endDate = 明日（APIは排他的終点のため）
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  // startDate = endDate - (days + 1)
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  return fetch{Service}Data({ startDate, endDate });
}
```

#### チャンク単位

| サービス | チャンク単位 | 理由 |
|----------|-------------|------|
| fitbit | 1日 | Intraday APIの制約 |
| gcalendar | 3ヶ月 | レート制限対応 |
| tanita | 3ヶ月 | API制約（最大3ヶ月） |
| toggl | 12ヶ月 | Reports APIパフォーマンス最適化 |
| zaim | 12ヶ月 | APIレスポンス時間最適化 |

#### レート制限対応

```typescript
try {
  // API呼び出し
} catch (err) {
  if (err instanceof ReportsApiQuotaError) {
    log.warn(`Quota exceeded. Waiting ${err.resetsInSeconds}s...`);
    await delay(err.resetsInSeconds * 1000);
    i--; // リトライ
    continue;
  }
  throw err;
}
```

#### エクスポート関数

| サービス | 日次同期用 | 全件同期用 |
|----------|-----------|-----------|
| fitbit | `fetchFitbitDataByDays(token, days)` | `fetchFitbitData(token, options)` |
| gcalendar | `fetchEventsByDays(days)` | `fetchAllEvents(options)` |
| tanita | `fetchTanitaDataByDays(token, days)` | `fetchTanitaData(token, options)` |
| toggl | `fetchTogglData(days)` | `fetchTogglDataWithChunks(start, end)` |
| zaim | `fetchZaimDataByDays(days)` | `fetchZaimDataWithChunks(start, end)` |

---

### 5. write_db.ts

**責務:** Supabaseへのデータ変換・書き込み（API型→DB型変換、バッチupsert）

#### セクション順序

```typescript
/**
 * {Service} データの Supabase 書き込み
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type { ... } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

export type {Service}Schema = ReturnType<SupabaseClient["schema"]>;

export interface UpsertResult {
  success: number;
  failed: number;
}

// =============================================================================
// Constants
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// Client Factory
// =============================================================================

export function create{Service}DbClient(): {Service}Schema

// =============================================================================
// Transform Functions: API → DB Record
// =============================================================================

export function toDb{Entity}(items: ApiType[]): DbType[]

// =============================================================================
// Batch Upsert
// =============================================================================

async function upsertBatch<T>(schema, table, records, onConflict): Promise<UpsertResult>

// =============================================================================
// Save/Upsert Functions
// =============================================================================

export async function save{Entity}(schema, items): Promise<UpsertResult>
```

#### Transform関数

命名規則: `toDb{Entity}(apiData): DbType[]`

| サービス | Transform関数 |
|----------|---------------|
| fitbit | `toDbSleep`, `toDbActivityDaily`, `toDbHeartRateDaily`, ... |
| gcalendar | `transformEvent`, `transformEvents` |
| tanita | `toDbBodyComposition`, `toDbBloodPressure`, `toDbSteps` |
| toggl | `toDbClient`, `toDbProject`, `toDbTag`, `toDbEntry` |
| zaim | `toDbCategory`, `toDbGenre`, `toDbAccount`, `toDbTransaction` |

#### Batch Upsert

全サービスで同一実装:

```typescript
async function upsertBatch<T extends object>(
  schema: {Service}Schema,
  table: string,
  records: T[],
  onConflict: string,
): Promise<UpsertResult> {
  let success = 0, failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await schema.from(table).upsert(batch, { onConflict });
    
    if (error) {
      log.error(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }
  return { success, failed };
}
```

#### onConflict列

| パターン | onConflict | 例 |
|----------|------------|-----|
| 単一主キー | `"id"` | toggl entries, gcalendar events |
| 日付ユニーク | `"date"` | fitbit daily tables |
| タイムスタンプ | `"measured_at"` | tanita tables |
| ログID | `"log_id"` | fitbit sleep |

---

### 6. sync_daily.ts

**責務:** 日次同期の実行（GitHub Actions用エントリーポイント）

#### セクション順序

```typescript
/**
 * {Service} → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   {SERVICE}_SYNC_DAYS=7 deno run ... sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Sync Function
// =============================================================================

export async function sync{Service}ByDays(syncDays?: number): Promise<SyncResult>

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await sync{Service}ByDays();
  Deno.exit(result.success ? 0 : 1);
}
```

#### 同期日数

```typescript
const days = syncDays ?? parseInt(Deno.env.get("{SERVICE}_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
```

| サービス | 環境変数 | デフォルト |
|----------|----------|------------|
| fitbit | `FITBIT_SYNC_DAYS` | 3 |
| gcalendar | `GCAL_SYNC_DAYS` | 3 |
| tanita | `TANITA_SYNC_DAYS` | 3 |
| toggl | `TOGGL_SYNC_DAYS` | 3 |
| zaim | `ZAIM_SYNC_DAYS` | 3 |

#### エクスポート関数

| サービス | 関数名 |
|----------|--------|
| fitbit | `syncFitbitByDays` |
| gcalendar | `syncGCalByDays` |
| tanita | `syncTanitaByDays` |
| toggl | `syncTogglByDays` |
| zaim | `syncZaimByDays` |

#### 認証処理の位置

| サービス | 認証方式 | 認証処理の位置 | 理由 |
|----------|----------|----------------|------|
| fitbit, tanita | OAuth 2.0 | sync_daily.ts | トークンリフレッシュ + DB保存が必要 |
| toggl, zaim, gcalendar | Basic/OAuth 1.0a/JWT | fetch_data.ts | 毎回同じ認証情報を使用 |

#### 内部フロー

```typescript
export async function sync{Service}ByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ?? parseInt(Deno.env.get("{SERVICE}_SYNC_DAYS") || "3");
  const errors: string[] = [];

  log.syncStart("{Service}", days);

  try {
    // Step 1: 認証確認（OAuth 2.0系のみ）
    const accessToken = await ensureValidToken();

    // Step 2: データ取得
    const data = await fetch{Service}DataByDays(accessToken, days);

    // Step 3: DB保存
    const schema = create{Service}DbClient();
    const stats = await saveAll{Service}Data(schema, data);

    // Step 4: 結果
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    log.syncEnd(true, elapsedSeconds);

    return { success: true, timestamp: new Date().toISOString(), stats, errors, elapsedSeconds };

  } catch (err) {
    // エラーハンドリング
  }
}
```

---

### 7. sync_all.ts

**責務:** 全件同期の実行（初回移行・リカバリ用）

#### セクション順序

```typescript
/**
 * {Service} → Supabase 全件同期
 *
 * 使用例:
 *   deno run ... sync_all.ts --start 2020-01-01 --end 2025-12-31
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";

// =============================================================================
// Constants
// =============================================================================

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// =============================================================================
// Sync Function
// =============================================================================

export async function syncAll{Service}Data(options: {
  startDate: Date;
  endDate: Date;
}): Promise<SyncResult>

// =============================================================================
// CLI Entry Point
// =============================================================================
```

#### CLIオプション

| オプション | 短縮 | 説明 |
|-----------|------|------|
| `--help` | `-h` | ヘルプ表示 |
| `--start` | `-s` | 開始日（YYYY-MM-DD） |
| `--end` | `-e` | 終了日（YYYY-MM-DD） |
| `--metadata-only` | `-m` | メタデータのみ同期（toggl, zaim） |
| `--intraday` | `-i` | Intradayデータ含む（fitbit） |

#### デフォルト開始日

環境変数から取得（ハードコードしない）:

| サービス | 環境変数 |
|----------|----------|
| fitbit | `FITBIT_SYNC_START_DATE` |
| gcalendar | `GCALENDAR_SYNC_START_DATE` |
| tanita | `TANITA_SYNC_START_DATE` |
| toggl | `TOGGL_SYNC_START_DATE` |
| zaim | `ZAIM_SYNC_START_DATE` |

#### エクスポート関数

| サービス | 関数名 | 追加オプション |
|----------|--------|---------------|
| fitbit | `syncAllFitbitData` | `includeIntraday?: boolean` |
| gcalendar | `syncAllGCalEvents` | - |
| tanita | `syncAllTanitaData` | - |
| toggl | `syncAllTogglData` | `metadataOnly?: boolean` |
| zaim | `syncAllZaimData` | `metadataOnly?: boolean` |

---

## 共通パターン

### セクション区切り

```typescript
// =============================================================================
// Section Name
// =============================================================================
```

### 環境変数バリデーション

```typescript
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}
```

### ログパターン

```typescript
log.syncStart("{Service}", days);           // 開始
log.section("Fetching from {Service} API"); // ステップ
log.info(`{DataType}: ${count}`);           // 情報
log.syncEnd(result.success, elapsedSeconds); // 終了
log.warn(`Errors: ${errors.join(", ")}`);   // 警告
```

### 終了コード

```typescript
if (import.meta.main) {
  const result = await sync{Service}ByDays();
  Deno.exit(result.success ? 0 : 1);
}
```

---

## オーケストレーター

| ファイル | 用途 | 対象 |
|----------|------|------|
| `src/sync_daily.ts` | 日次同期 | 各サービスの `sync_daily.ts` を並列実行 |
| `src/sync_all.ts` | 全件同期 | 各サービスの `sync_all.ts` を順次実行 |

## GitHub Actions

| ワークフロー | 用途 | スケジュール |
|-------------|------|-------------|
| `sync-daily.yml` | 全サービス日次同期 | 毎日 JST 09:00 |
| `sync-{service}.yml` | 個別サービス同期 | 手動実行 |

---

詳細は各サービスの README.md を参照。
