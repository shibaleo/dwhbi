# Zaim 同期モジュール

Zaim API から家計簿データを取得し、Supabase `zaim` スキーマに同期する。

## クイックスタート

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `ZAIM_CONSUMER_KEY` | Yes | Zaim OAuth Consumer Key |
| `ZAIM_CONSUMER_SECRET` | Yes | Zaim OAuth Consumer Secret |
| `ZAIM_ACCESS_TOKEN` | Yes | Zaim OAuth Access Token |
| `ZAIM_ACCESS_TOKEN_SECRET` | Yes | Zaim OAuth Access Token Secret |
| `ZAIM_SYNC_DAYS` | No | 同期日数（デフォルト: 3） |

### 実行コマンド

```bash
# 日次同期（直近3日間）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近7日間）
ZAIM_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（デフォルト: 2025年3月〜今月）
deno run --allow-env --allow-net --allow-read sync_all_transactions.ts

# 全件同期（期間指定）
deno run --allow-env --allow-net --allow-read sync_all_transactions.ts \
  --start=2024 --start-month=1 --end=2025 --end-month=12

# 全件同期（中断から再開）
deno run --allow-env --allow-net --allow-read sync_all_transactions.ts --resume=2024
```

---

## アーキテクチャ

### データパイプライン

```
Zaim API                        変換                      Supabase
───────────────────────────────────────────────────────────────────
/v2/home/money        →  toDbTransaction()  →  zaim.transactions
/v2/home/category     →  toDbCategory()     →  zaim.categories
/v2/home/genre        →  toDbGenre()        →  zaim.genres
/v2/home/account      →  toDbAccount()      →  zaim.accounts
```

### ファイル構成

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | Zaim API型定義 | No |
| `auth.ts` | OAuth 1.0a署名生成・HTTPリクエスト | No |
| `api.ts` | Zaim APIクライアント | No |
| `fetch_data.ts` | データ取得オーケストレーション（ページネーション対応） | Yes |
| `write_db.ts` | DB書き込み（変換・upsert・同期ログ） | No |
| `sync_daily.ts` | 日次同期（直近N日間） | Yes |
| `sync_all_transactions.ts` | 全件同期（年単位チャンク） | Yes |

---

## モジュール詳細

### types.ts

Zaim API レスポンス型を定義。

```typescript
interface ZaimTransaction {
  id: number;
  mode: 'payment' | 'income' | 'transfer';
  date: string;
  category_id: number;
  genre_id: number;
  from_account_id?: number;
  to_account_id?: number;
  amount: number;
  comment?: string;
  place?: string;
  created: string;
}

interface ZaimCategory {
  id: number;
  mode: string;
  name: string;
  sort: number;
  active: number;
}

interface ZaimGenre {
  id: number;
  category_id: number;
  name: string;
  sort: number;
  active: number;
}

interface ZaimAccount {
  id: number;
  name: string;
  sort: number;
  active: number;
}

interface OAuthConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}
```

### auth.ts

OAuth 1.0a認証を処理する低レベルモジュール。

```typescript
class ZaimOAuth {
  constructor(config: OAuthConfig)
  async get(url: string): Promise<any>
  async post(url: string, body: Record<string, any>): Promise<any>
}
```

### api.ts

Zaim APIクライアント。

```typescript
class ZaimAPI {
  constructor()  // 環境変数から認証情報を読み込む
  
  async getMoney(params?: { start_date?, end_date?, mode?, page?, limit? }): Promise<{ money: ZaimTransaction[] }>
  async getCategories(): Promise<{ categories: ZaimCategory[] }>
  async getGenres(): Promise<{ genres: ZaimGenre[] }>
  async getAccounts(): Promise<{ accounts: ZaimAccount[] }>
  async verifyUser(): Promise<any>
}
```

### fetch_data.ts

ページネーション処理を内包したデータ取得。

```typescript
interface FetchOptions {
  startDate?: string;  // YYYY-MM-DD（デフォルト: 30日前）
  endDate?: string;    // YYYY-MM-DD（デフォルト: 今日）
  mode?: 'payment' | 'income' | 'transfer';
  limit?: number;      // 1ページあたりの件数（デフォルト: 100）
}

interface ZaimData {
  zaimUserId: number;
  categories: ZaimCategory[];
  genres: ZaimGenre[];
  accounts: ZaimAccount[];
  transactions: ZaimTransaction[];
}

async function fetchZaimData(options?: FetchOptions): Promise<ZaimData>
```

### write_db.ts

Supabase `zaim` スキーマへの書き込み。

```typescript
// DB型
interface DbCategory { zaim_user_id, id, mode, name, sort, is_active }
interface DbGenre { zaim_user_id, id, category_id, name, sort, is_active }
interface DbAccount { zaim_user_id, id, name, sort, is_active }
interface DbTransaction { zaim_user_id, zaim_id, mode, date, category_id, genre_id, ... }

// 変換関数
function toDbCategory(category: ZaimCategory, zaimUserId: number): DbCategory
function toDbGenre(genre: ZaimGenre, zaimUserId: number): DbGenre
function toDbAccount(account: ZaimAccount, zaimUserId: number): DbAccount
function toDbTransaction(tx: ZaimTransaction, zaimUserId: number): DbTransaction

// バッチupsert
async function upsertBatch<T>(zaim, table, records, onConflict, batchSize?): Promise<UpsertResult>

// 同期ログ
async function startSyncLog(zaim, zaimUserId, endpoint): Promise<string>
async function completeSyncLog(zaim, logId, status, stats, errorMessage?): Promise<void>

// 高レベルヘルパー
async function syncMasters(zaim, zaimUserId, categories, genres, accounts): Promise<{...}>
async function syncTransactions(zaim, zaimUserId, transactions, existingIds): Promise<{...}>
```

### sync_daily.ts

日次同期オーケストレーター。

```typescript
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

async function syncZaimData(options?: FetchOptions): Promise<SyncResult>
```

### sync_all_transactions.ts

全期間のトランザクションを年単位で同期。

```typescript
interface SyncConfig {
  startYear?: number;
  startMonth?: number;
  endYear?: number;
  endMonth?: number;
  delayBetweenYears?: number;
  resumeFrom?: number;
}

async function syncAllTransactions(config?: SyncConfig): Promise<void>
async function syncFromYear(year: number): Promise<void>
async function syncRange(startYear, startMonth, endYear, endMonth): Promise<void>
```

**CLIオプション**: `--start`, `--start-month`, `--end`, `--end-month`, `--resume`, `--delay`, `--help`

---

## データベーススキーマ

### zaim スキーマ

| テーブル | 主キー | ユニーク制約 | 説明 |
|----------|--------|-------------|------|
| `categories` | - | `(zaim_user_id, id)` | 大分類マスタ |
| `genres` | - | `(zaim_user_id, id)` | 小分類マスタ |
| `accounts` | - | `(zaim_user_id, id)` | 口座マスタ |
| `transactions` | - | `(zaim_user_id, zaim_id)` | 取引データ |
| `sync_log` | `id` (UUID) | - | 同期ログ |
| `monthly_summary` | - | - | マテリアライズドビュー |

### public スキーマ（互換性ビュー）

`public.zaim_*` は `zaim.*` を参照するビュー。読み取り専用。

---

## API仕様

### 認証方式

OAuth 1.0a。トークンは環境変数から取得。

### エンドポイント

| エンドポイント | 説明 |
|---------------|------|
| `/v2/home/money` | 取引一覧（ページネーション対応） |
| `/v2/home/category` | カテゴリ一覧 |
| `/v2/home/genre` | ジャンル一覧 |
| `/v2/home/account` | 口座一覧 |
| `/v2/home/user/verify` | ユーザー認証確認 |

### 制約・制限

| 項目 | 値 |
|------|-----|
| ページサイズ | 最大100件/リクエスト |
| レート制限 | 明確な制限なし（常識的な範囲で） |

---

## 日付範囲の計算パターン

全サービス共通パターン:

```typescript
// endDate = 明日（APIは排他的終点のため）
const endDate = new Date();
endDate.setDate(endDate.getDate() + 1);

// startDate = endDate - (days + 1)
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - days - 1);
```

このパターンにより `days日前から今日まで` のデータを確実に取得。

---

## テスト

### 単体テスト

```bash
# 変換関数テスト
deno test --allow-env test/zaim/write_db.test.ts
```

### 手動統合テスト

```bash
# API疎通確認
deno run --allow-env --allow-net test/zaim/manual/check_api.ts

# 同期動作確認（直近1日分）
deno run --allow-env --allow-net --allow-read test/zaim/manual/check_sync.ts
```

詳細は `test/zaim/README.md` を参照。

---

## GitHub Actions

定期実行は `sync-all.yml` に統合（毎日 JST 00:00）。

個別実行は `sync-zaim.yml` で手動トリガー可能。

---

## 初回セットアップ

1. [Zaim Developer](https://dev.zaim.net/) でアプリケーション登録

2. OAuth 1.0a フローでアクセストークンを取得

3. 環境変数を設定

4. 全件同期を実行:
   ```bash
   deno run --allow-env --allow-net --allow-read sync_all_transactions.ts \
     --start=2020 --start-month=1
   ```

---

## DWH移行計画

### 概要

現在の `zaim` スキーマを `raw` スキーマに移行し、DWH 3層アーキテクチャを採用する。

```
現在:  zaim.transactions, zaim.categories, zaim.genres, zaim.accounts
    ↓
移行後:
  raw.zaim_transactions     ← 生データ（テーブル）
  raw.zaim_categories
  raw.zaim_genres
  raw.zaim_accounts
      ↓
  staging.stg_zaim__transactions   ← クリーニング済み（ビュー）
  staging.stg_zaim__categories
      ↓
  marts.fct_expenses               ← ビジネスエンティティ（ビュー）
  marts.dim_categories
```

### 変更点

| 項目 | 現在 | 移行後 |
|------|------|--------|
| スキーマ | `zaim` | `raw` |
| テーブル名 | `transactions` | `zaim_transactions` |
| DBクライアント | supabase-js (REST API) | postgres.js (直接接続) |
| API公開 | Exposed | Not Exposed |

### write_db.ts 変更内容

```typescript
// 現在
import { createClient } from "npm:@supabase/supabase-js@2";
const supabase = createClient(url, key);
const zaim = supabase.schema("zaim");
await zaim.from("transactions").upsert(data, { onConflict: "zaim_user_id,zaim_id" });

// 移行後
import postgres from "npm:postgres";
const sql = postgres(DATABASE_URL);
await sql`
  INSERT INTO raw.zaim_transactions ${sql(records)}
  ON CONFLICT (zaim_user_id, zaim_id) DO UPDATE SET
    amount = EXCLUDED.amount,
    category_id = EXCLUDED.category_id,
    genre_id = EXCLUDED.genre_id,
    comment = EXCLUDED.comment,
    synced_at = now()
`;
```

### 環境変数追加

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | PostgreSQL 直接接続文字列 |

### マイグレーション手順

1. `raw.zaim_*` テーブルを作成
2. `zaim.*` から `raw.zaim_*` にデータ移行
3. `write_db.ts` を postgres.js に書き換え
4. `staging.stg_zaim__*` ビューを作成
5. 旧 `zaim` スキーマを削除（データ確認後）

### sync_log の扱い

`zaim.sync_log` は同期メタデータのため、`raw` 層ではなく `ops` スキーマまたは別途管理を検討。
