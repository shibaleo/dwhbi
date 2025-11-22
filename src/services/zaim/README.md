# Zaim同期モジュール

Zaim APIからデータを取得し、Supabaseの`zaim`スキーマに同期するモジュール群。

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        外部サービス                              │
├─────────────────────────────────────────────────────────────────┤
│  Zaim API (api.zaim.net)          Supabase (zaim スキーマ)      │
│  - /v2/home/money                 - zaim.transactions           │
│  - /v2/home/category              - zaim.categories             │
│  - /v2/home/genre                 - zaim.genres                 │
│  - /v2/home/account               - zaim.accounts               │
│  - /v2/home/user/verify           - zaim.sync_log               │
└─────────────────────────────────────────────────────────────────┘
          │                                   ▲
          │ OAuth 1.0a                        │ upsert
          ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│                        モジュール構成                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   auth.ts    │◄─────│    api.ts    │◄─────│ fetch_data.ts│  │
│  │              │      │              │      │              │  │
│  │ OAuth署名生成 │      │ APIクライアント│      │ データ取得   │  │
│  └──────────────┘      └──────────────┘      └──────┬───────┘  │
│                                                      │          │
│                                                      ▼          │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   types.ts   │◄─────│ write_db.ts  │◄─────│ sync_daily.ts│  │
│  │              │      │              │      │              │  │
│  │ 型定義       │      │ DB書き込み   │      │ 日次同期     │  │
│  └──────────────┘      └──────┬───────┘      └──────────────┘  │
│                               │                                 │
│                               │              ┌──────────────┐  │
│                               └──────────────│sync_all_     │  │
│                                              │transactions  │  │
│                                              │.ts           │  │
│                                              │              │  │
│                                              │ 全件同期     │  │
│                                              └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## ファイル一覧

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | Zaim API型定義 | No |
| `auth.ts` | OAuth 1.0a署名生成・HTTPリクエスト | No |
| `api.ts` | Zaim APIクライアント | No |
| `fetch_data.ts` | データ取得のオーケストレーション | Yes |
| `write_db.ts` | Supabase DB書き込み（変換・upsert・ログ） | No |
| `sync_daily.ts` | 日次同期（直近N日間） | Yes |
| `sync_all_transactions.ts` | 全件同期（年単位チャンク） | Yes |

---

## モジュール境界

### types.ts

Zaim API のレスポンス型定義。

```typescript
export interface ZaimTransaction { ... }
export interface ZaimCategory { ... }
export interface ZaimGenre { ... }
export interface ZaimAccount { ... }
export interface OAuthConfig { ... }
```

---

### auth.ts

OAuth 1.0a認証を処理する低レベルモジュール。

```typescript
export class ZaimOAuth {
  constructor(config: OAuthConfig)
  async get(url: string): Promise<any>
  async post(url: string, body: Record<string, any>): Promise<any>
}
```

**依存**: なし（外部ライブラリ `oauth-1.0a` のみ）

---

### api.ts

Zaim APIのエンドポイントをラップするクライアント。

```typescript
export class ZaimAPI {
  constructor()  // 環境変数から認証情報を読み込む
  
  async getMoney(params?: { ... }): Promise<{ money: ZaimTransaction[] }>
  async getCategories(): Promise<{ categories: ZaimCategory[] }>
  async getGenres(): Promise<{ genres: ZaimGenre[] }>
  async getAccounts(): Promise<{ accounts: ZaimAccount[] }>
  async verifyUser(): Promise<any>
}
```

**依存**: `auth.ts`, `types.ts`

**環境変数**: `ZAIM_CONSUMER_KEY`, `ZAIM_CONSUMER_SECRET`, `ZAIM_ACCESS_TOKEN`, `ZAIM_ACCESS_TOKEN_SECRET`

---

### fetch_data.ts

Zaim APIからのデータ取得を統合。ページネーション処理を内包。

```typescript
// 入力
export interface FetchOptions {
  startDate?: string;  // YYYY-MM-DD（デフォルト: 30日前）
  endDate?: string;    // YYYY-MM-DD（デフォルト: 今日）
  mode?: 'payment' | 'income' | 'transfer';
  limit?: number;      // 1ページあたりの件数（デフォルト: 100）
}

// 出力
export interface ZaimData {
  zaimUserId: number;
  categories: ZaimCategory[];
  genres: ZaimGenre[];
  accounts: ZaimAccount[];
  transactions: ZaimTransaction[];
}

// メイン関数
export async function fetchZaimData(options?: FetchOptions): Promise<ZaimData>
```

**依存**: `api.ts`, `types.ts`

---

### write_db.ts

Supabase zaim スキーマへのDB書き込みを集約。

```typescript
// 型
export type ZaimSchema = ReturnType<SupabaseClient['schema']>
export type SyncStatus = 'running' | 'completed' | 'failed'
export interface DbCategory { ... }
export interface DbGenre { ... }
export interface DbAccount { ... }
export interface DbTransaction { ... }
export interface UpsertResult { success: number; failed: number }

// クライアント作成
export function createZaimClient(): ZaimSchema

// 変換関数: Zaim API → DB レコード
export function toDbCategory(category: ZaimCategory, zaimUserId: number): DbCategory
export function toDbGenre(genre: ZaimGenre, zaimUserId: number): DbGenre
export function toDbAccount(account: ZaimAccount, zaimUserId: number): DbAccount
export function toDbTransaction(tx: ZaimTransaction, zaimUserId: number): DbTransaction

// バッチ upsert
export async function upsertBatch<T>(
  zaim: ZaimSchema,
  table: string,
  records: T[],
  onConflict: string,
  batchSize?: number
): Promise<UpsertResult>

// 同期ログ
export async function startSyncLog(zaim, zaimUserId, endpoint): Promise<string>
export async function completeSyncLog(zaim, logId, status, stats, errorMessage?): Promise<void>

// 高レベルヘルパー
export async function syncMasters(zaim, zaimUserId, categories, genres, accounts): Promise<{...}>
export async function syncTransactions(zaim, zaimUserId, transactions, existingIds): Promise<{...}>
export async function getExistingTransactionIds(zaim, zaimUserId, startDate, endDate): Promise<Set<number>>
```

**依存**: `types.ts`

**環境変数**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

**書き込み先テーブル**:
- `zaim.categories` (upsert on `zaim_user_id, id`)
- `zaim.genres` (upsert on `zaim_user_id, id`)
- `zaim.accounts` (upsert on `zaim_user_id, id`)
- `zaim.transactions` (upsert on `zaim_user_id, zaim_id`)
- `zaim.sync_log` (insert/update)

---

### sync_daily.ts

日次同期を実行するオーケストレーター。

```typescript
// 出力
interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: {
    categories: number;
    genres: number;
    accounts: number;
    transactions: { fetched, inserted, updated, skipped };
  };
  errors: string[];
  elapsedSeconds: number;
}

// メイン関数
export async function syncZaimData(options?: FetchOptions): Promise<SyncResult>
```

**依存**: `fetch_data.ts`, `write_db.ts`

---

### sync_all_transactions.ts

全期間のトランザクションを年単位で同期。初回移行・リカバリ用。

```typescript
// 入力
interface SyncConfig {
  startYear?: number;       // デフォルト: 2025
  startMonth?: number;      // デフォルト: 3
  endYear?: number;         // デフォルト: 今年
  endMonth?: number;        // デフォルト: 今月
  delayBetweenYears?: number;  // デフォルト: 200ms
  resumeFrom?: number;      // 再開する年
}

// メイン関数
export async function syncAllTransactions(config?: SyncConfig): Promise<void>
export async function syncFromYear(year: number): Promise<void>
export async function syncRange(startYear, startMonth, endYear, endMonth): Promise<void>
```

**依存**: `fetch_data.ts`, `write_db.ts`

**CLIオプション**: `--start`, `--start-month`, `--end`, `--end-month`, `--resume`, `--delay`, `--help`

---

## データフロー

### 日次同期 (sync_daily.ts)

```
fetchZaimData() ──► ZaimData ──► write_db ──► Supabase
      │                              │
      ▼                              ▼
   Zaim API                   zaim.* tables
                              zaim.sync_log
```

### 全件同期 (sync_all_transactions.ts)

```
syncAllTransactions() ──┬──► fetchZaimData() ──► Zaim API
        │               │         (年ごとに呼び出し)
        │               │
        │               └──► write_db ──► Supabase
        ▼
   進捗表示 (コンソール)
```

---

## Supabaseスキーマ

スキーマ定義SQL: [`src/services/supabase/create_zaim_schema.sql`](../supabase/create_zaim_schema.sql)

### zaim スキーマ（実体）

| テーブル | 主キー | 説明 |
|----------|--------|------|
| `categories` | `(zaim_user_id, id)` | 大分類マスタ |
| `genres` | `(zaim_user_id, id)` | 小分類マスタ |
| `accounts` | `(zaim_user_id, id)` | 口座マスタ |
| `transactions` | `(zaim_user_id, zaim_id)` | 取引データ |
| `sync_log` | `id` (UUID) | 同期ログ |
| `monthly_summary` | - | マテリアライズドビュー |

### public スキーマ（互換性ビュー）

`public.zaim_*` は `zaim.*` を参照するビュー。読み取り専用。

---

## 実行例

```bash
# 日次同期（直近3日間）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近7日間）
ZAIM_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（デフォルト: 2025年3月〜今月）
deno run --allow-env --allow-net --allow-read sync_all_transactions.ts

# 全件同期（特定期間）
deno run --allow-env --allow-net --allow-read sync_all_transactions.ts \
  --start=2024 --start-month=1 --end=2025 --end-month=12

# 全件同期（中断から再開）
deno run --allow-env --allow-net --allow-read sync_all_transactions.ts --resume=2024
```

---

## GitHub Actions

日次同期は GitHub Actions で自動実行されます。

| ファイル | スケジュール | 説明 |
|----------|--------------|------|
| `.github/workflows/sync-zaim.yml` | 毎日 JST 00:00 | `sync_daily.ts` を実行 |

### 手動実行

GitHub の Actions タブから `Zaim Daily Sync` を選択し、`Run workflow` で手動実行可能です。`sync_days` パラメータで同期日数を指定できます。

---

## テスト

テストファイルは `test/zaim/` に配置されています。詳細は [test/zaim/README.md](../../../test/zaim/README.md) を参照してください。

```bash
# 単体テスト（変換関数）
deno test --allow-env test/zaim/write_db.test.ts

# API疎通確認
deno run --allow-env --allow-net test/zaim/manual/check_api.ts

# 同期動作確認（直近1日分）
deno run --allow-env --allow-net --allow-read test/zaim/manual/check_sync.ts
```

---

## 環境変数一覧

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `ZAIM_CONSUMER_KEY` | Yes | Zaim OAuth Consumer Key |
| `ZAIM_CONSUMER_SECRET` | Yes | Zaim OAuth Consumer Secret |
| `ZAIM_ACCESS_TOKEN` | Yes | Zaim OAuth Access Token |
| `ZAIM_ACCESS_TOKEN_SECRET` | Yes | Zaim OAuth Access Token Secret |
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `ZAIM_SYNC_DAYS` | No | 同期日数（sync_daily.ts用、デフォルト: 3）|

---

## 日付範囲の計算パターン

全サービス共通の日付範囲計算パターン:

```typescript
// endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
const endDate = new Date();
endDate.setDate(endDate.getDate() + 1);

// startDate = endDate - (days + 1)
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - days - 1);
```

このパターンにより `days日前から今日まで` のデータを確実に取得できます。
