# Tanita同期モジュール

Tanita Health Planet APIからデータを取得し、Supabaseの`tanita`スキーマに同期するモジュール群。

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        外部サービス                              │
├─────────────────────────────────────────────────────────────────┤
│  Tanita Health Planet API         Supabase (tanita スキーマ)    │
│  - /oauth/token                   - tanita.tokens               │
│  - /status/innerscan              - tanita.body_composition     │
│  - /status/sphygmomanometer       - tanita.blood_pressure       │
│  - /status/pedometer              - tanita.steps                │
└─────────────────────────────────────────────────────────────────┘
          │                                   ▲
          │ OAuth 2.0                         │ upsert
          ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│                        モジュール構成                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   auth.ts    │◄─────│    api.ts    │◄─────│ fetch_data.ts│  │
│  │              │      │              │      │              │  │
│  │ OAuth2.0    │      │ APIクライアント│      │ データ取得   │  │
│  │ トークン管理 │      │              │      │              │  │
│  └──────────────┘      └──────────────┘      └──────┬───────┘  │
│                                                      │          │
│                                                      ▼          │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   types.ts   │◄─────│ write_db.ts  │◄─────│ sync_daily.ts│  │
│  │              │      │              │      │              │  │
│  │ 型定義       │      │ DB書き込み   │      │ 日次同期     │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│                               │                                 │
│                               │              ┌──────────────┐  │
│                               └──────────────│ sync_all.ts  │  │
│                                              │              │  │
│                                              │ 全件同期     │  │
│                                              └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## ファイル一覧

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | API/DB型定義、タグ定数 | No |
| `auth.ts` | OAuth2.0トークン管理（取得・リフレッシュ・DB操作） | Yes |
| `api.ts` | Tanita APIクライアント | No |
| `fetch_data.ts` | データ取得オーケストレーション（3ヶ月チャンク自動分割） | No |
| `write_db.ts` | DB書き込み（変換・upsert） | No |
| `sync_daily.ts` | 日次同期（直近N日間） | Yes |
| `sync_all.ts` | 全件同期（初回移行・リカバリ用） | Yes |

---

## モジュール境界

### types.ts

型定義とタグ定数。

```typescript
// API型
export interface TanitaApiResponse { ... }
export interface TanitaDataItem { ... }
export interface TokenResponse { ... }

// DB型
export interface DbToken { ... }
export interface DbBodyComposition { ... }
export interface DbBloodPressure { ... }
export interface DbSteps { ... }

// タグ定数
export const TAGS = {
  WEIGHT: "6021",
  BODY_FAT_PERCENT: "6022",
  SYSTOLIC: "622E",
  DIASTOLIC: "622F",
  PULSE: "6230",
  STEPS: "6331",
}
```

---

### auth.ts

OAuth2.0認証を管理。トークンはSupabase `tanita.tokens`に保存。

```typescript
// 有効性チェック（DBの expires_at を参照、APIを叩かない）
export function isTokenExpiringSoon(expiresAt: Date, thresholdDays?: number): boolean

// リフレッシュ実行（APIを叩く）
// - 成功 → 新しいトークンを返す
// - "SUCCESS" → null（既に有効）
export async function refreshTokenFromApi(refreshToken: string): Promise<TokenResponse | null>

// メイン関数: 有効なアクセストークンを保証
export async function ensureValidToken(options?: AuthOptions): Promise<string>
```

**CLI使用法**:
```bash
# 有効性確認（必要ならリフレッシュ）
deno run --allow-env --allow-net --allow-read auth.ts

# 強制リフレッシュ
deno run --allow-env --allow-net --allow-read auth.ts --refresh

# 初回トークン取得
deno run --allow-env --allow-net --allow-read auth.ts --init --code=YOUR_AUTH_CODE
```

---

### api.ts

Tanita Health Planet APIのエンドポイントをラップ。

```typescript
export class TanitaAPI {
  constructor(accessToken: string)
  
  async getBodyComposition(from: Date, to: Date): Promise<TanitaApiResponse>
  async getBloodPressure(from: Date, to: Date): Promise<TanitaApiResponse>
  async getSteps(from: Date, to: Date): Promise<TanitaApiResponse>
}

// ヘルパー
export function formatTanitaDate(date: Date): string      // Date → YYYYMMDDHHmmss
export function parseTanitaDate(dateStr: string): Date    // YYYYMMDDHHmm → Date (UTC)
```

---

### fetch_data.ts

3ヶ月制限を考慮したデータ取得オーケストレーション。

```typescript
export interface TanitaData {
  bodyComposition: TanitaDataItem[];
  bloodPressure: TanitaDataItem[];
  steps: TanitaDataItem[];
}

// 期間を3ヶ月チャンクに分割
export function generatePeriods(startDate: Date, endDate: Date): Array<{ from: Date; to: Date }>

// メイン関数
export async function fetchTanitaData(accessToken: string, options?: FetchOptions): Promise<TanitaData>
```

---

### write_db.ts

Supabase `tanita`スキーマへの書き込み。

```typescript
// Supabaseクライアント
export function createTanitaDbClient(): SupabaseClient

// 変換関数: API → DB レコード（測定時刻でグループ化）
export function toDbBodyComposition(items: TanitaDataItem[]): DbBodyComposition[]
export function toDbBloodPressure(items: TanitaDataItem[]): DbBloodPressure[]
export function toDbSteps(items: TanitaDataItem[]): DbSteps[]

// 保存関数
export async function saveBodyComposition(supabase, items): Promise<UpsertResult>
export async function saveBloodPressure(supabase, items): Promise<UpsertResult>
export async function saveSteps(supabase, items): Promise<UpsertResult>
```

---

### sync_daily.ts

日次同期オーケストレーター。

```typescript
export async function syncTanitaDaily(syncDays?: number): Promise<SyncResult>
```

---

### sync_all.ts

全件同期（初回移行・リカバリ用）。

```typescript
export async function syncAllTanitaData(startDate: Date, endDate: Date): Promise<void>
```

---

## データフロー

### 日次同期 (sync_daily.ts)

```
ensureValidToken() ──► accessToken
        │
        ▼
fetchTanitaData() ──► TanitaData ──► write_db ──► Supabase
        │                                │
        ▼                                ▼
   Tanita API                      tanita.* tables
   (3エンドポイント)
```

### 全件同期 (sync_all.ts)

```
syncAllTanitaData(startDate, endDate)
        │
        ├──► ensureValidToken()
        │
        ├──► fetchTanitaData() ──► Tanita API
        │         (3ヶ月チャンク自動分割)
        │
        └──► write_db ──► Supabase
```

---

## Supabaseスキーマ

### tanita スキーマ

| テーブル | 主キー | ユニーク制約 | 説明 |
|----------|--------|-------------|------|
| `tokens` | `id` (UUID) | - | OAuth2.0トークン |
| `body_composition` | `id` (UUID) | `measured_at` | 体重・体脂肪率 |
| `blood_pressure` | `id` (UUID) | `measured_at` | 血圧・脈拍 |
| `steps` | `id` (UUID) | `measured_at` | 歩数 |

---

## 実行例

```bash
# 認証確認（必要ならリフレッシュ）
deno run --allow-env --allow-net --allow-read auth.ts

# 日次同期（直近30日間、デフォルト）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近7日間）
TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（デフォルト: 2025-03-01〜今日）
deno run --allow-env --allow-net --allow-read sync_all.ts

# 全件同期（特定期間）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
```

---

## 環境変数一覧

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `TANITA_CLIENT_ID` | Yes | Tanita OAuth Client ID |
| `TANITA_CLIENT_SECRET` | Yes | Tanita OAuth Client Secret |
| `TANITA_AUTH_CODE` | No | 認可コード（--init 時に使用） |
| `TANITA_SYNC_DAYS` | No | 同期日数（sync_daily.ts用、デフォルト: 30） |

---

## Tanita API 制約

| 項目 | 値 |
|------|-----|
| 最大取得期間 | 3ヶ月 |
| レート制限 | 60回/時間 |
| トークン有効期限 | 約30日 |
| 利用可能タグ | 6021(体重), 6022(体脂肪率), 622E(最高血圧), 622F(最低血圧), 6230(脈拍), 6331(歩数) |

※ 筋肉量、基礎代謝、内臓脂肪レベル等は2020/6/29で提供終了

---

## テスト

### 単体テスト

```bash
# 全テスト実行（50件）
deno test test/tanita/ --allow-env --allow-read

# 個別実行
deno test test/tanita/api.test.ts --allow-env          # 11件: parseTanitaDate, formatTanitaDate
deno test test/tanita/auth.test.ts --allow-env         # 10件: isTokenExpiringSoon
deno test test/tanita/fetch_data.test.ts --allow-env   # 10件: generatePeriods
deno test test/tanita/write_db.test.ts --allow-env --allow-read  # 19件: toDb* 変換関数
```

### 手動統合テスト

実際のAPI/DBを使ったテスト。`test/tanita/manual/README.md`参照。

```bash
# 1. 認証テスト
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_auth.ts

# 2. データ取得テスト（DB書き込みなし）
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_fetch.ts

# 3. DB内容確認
deno run --allow-env --allow-net --allow-read test/tanita/manual/check_db.ts

# 4. 同期テスト（DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_sync.ts
```

### テストファイル構成

```
test/tanita/
├── api.test.ts          # api.ts の純粋関数テスト
├── auth.test.ts         # auth.ts の純粋関数テスト
├── fetch_data.test.ts   # fetch_data.ts の純粋関数テスト
├── write_db.test.ts     # write_db.ts の変換関数テスト
├── run_tests.bat        # Windows用一括実行
├── run_tests.sh         # Unix用一括実行
└── manual/
    ├── README.md        # 手動テストの説明
    ├── test_auth.ts     # 認証フローテスト
    ├── test_fetch.ts    # API取得テスト
    ├── test_sync.ts     # 統合テスト（DB書き込み）
    └── check_db.ts      # DB内容確認
```

---

## 初回セットアップ

1. [Tanita Health Planet](https://www.healthplanet.jp/)でアプリケーション登録
2. 認可URLにアクセスして認可コードを取得:
   ```
   https://www.healthplanet.jp/oauth/auth?client_id=YOUR_CLIENT_ID&redirect_uri=https://www.healthplanet.jp/success.html&scope=innerscan,sphygmomanometer,pedometer&response_type=code
   ```
3. 初回トークン取得:
   ```bash
   deno run --allow-env --allow-net --allow-read auth.ts --init --code=YOUR_AUTH_CODE
   ```
