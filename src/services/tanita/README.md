# Tanita 同期モジュール

Tanita Health Planet API から体組成・血圧・歩数データを取得し、Supabase `tanita` スキーマに同期する。

## クイックスタート

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `TANITA_CLIENT_ID` | Yes | Tanita OAuth Client ID |
| `TANITA_CLIENT_SECRET` | Yes | Tanita OAuth Client Secret |
| `TANITA_AUTH_CODE` | No | 認可コード（--init 時に使用） |
| `TANITA_SYNC_DAYS` | No | 同期日数（デフォルト: 3） |

### 実行コマンド

```bash
# 日次同期（直近3日間）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近7日間）
TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（デフォルト: 2025-03-01〜今日）
deno run --allow-env --allow-net --allow-read sync_all.ts

# 全件同期（期間指定）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

# 認証確認・強制リフレッシュ
deno run --allow-env --allow-net --allow-read auth.ts --refresh

# 初回トークン取得
deno run --allow-env --allow-net --allow-read auth.ts --init --code=YOUR_AUTH_CODE
```

---

## アーキテクチャ

### データパイプライン

```
Tanita Health Planet API          変換                       Supabase
────────────────────────────────────────────────────────────────────────
/status/innerscan       →  toDbBodyComposition()  →  tanita.body_composition
/status/sphygmomanometer→  toDbBloodPressure()    →  tanita.blood_pressure
/status/pedometer       →  toDbSteps()            →  tanita.steps
```

### ファイル構成

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

## モジュール詳細

### types.ts

API型・DB型・タグ定数を定義。

```typescript
// API型
interface TanitaApiResponse { ... }
interface TanitaDataItem { ... }
interface TokenResponse { ... }

// DB型
interface DbToken { ... }
interface DbBodyComposition { ... }
interface DbBloodPressure { ... }
interface DbSteps { ... }

// タグ定数（利用可能なもののみ）
const TAGS = {
  WEIGHT: "6021",
  BODY_FAT_PERCENT: "6022",
  SYSTOLIC: "622E",
  DIASTOLIC: "622F",
  PULSE: "6230",
  STEPS: "6331",
}
```

### auth.ts

OAuth2.0認証管理。トークンは `tanita.tokens` に保存。

```typescript
// 有効性チェック（APIを叩かない）
function isTokenExpiringSoon(expiresAt: Date, thresholdDays?: number): boolean

// リフレッシュ実行
// - 成功 → 新しいトークンを返す
// - "SUCCESS" → null（既に有効）
async function refreshTokenFromApi(refreshToken: string): Promise<TokenResponse | null>

// メイン関数: 有効なアクセストークンを保証
async function ensureValidToken(options?: AuthOptions): Promise<string>
```

### api.ts

Tanita Health Planet APIクライアント。

```typescript
class TanitaAPI {
  constructor(accessToken: string)
  
  async getBodyComposition(from: Date, to: Date): Promise<TanitaApiResponse>
  async getBloodPressure(from: Date, to: Date): Promise<TanitaApiResponse>
  async getSteps(from: Date, to: Date): Promise<TanitaApiResponse>
}

// ヘルパー
function formatTanitaDate(date: Date): string   // → YYYYMMDDHHmmss
function parseTanitaDate(dateStr: string): Date // → Date (UTC)
```

### fetch_data.ts

3ヶ月制限を考慮したデータ取得。

```typescript
interface TanitaData {
  bodyComposition: TanitaDataItem[];
  bloodPressure: TanitaDataItem[];
  steps: TanitaDataItem[];
}

// 期間を3ヶ月チャンクに分割
function generatePeriods(startDate: Date, endDate: Date): Array<{ from: Date; to: Date }>

// メイン関数
async function fetchTanitaData(accessToken: string, options?: FetchOptions): Promise<TanitaData>
```

### write_db.ts

Supabase `tanita` スキーマへの書き込み。

```typescript
// 変換関数: API → DB（測定時刻でグループ化）
function toDbBodyComposition(items: TanitaDataItem[]): DbBodyComposition[]
function toDbBloodPressure(items: TanitaDataItem[]): DbBloodPressure[]
function toDbSteps(items: TanitaDataItem[]): DbSteps[]

// 保存関数
async function saveBodyComposition(supabase, items): Promise<UpsertResult>
async function saveBloodPressure(supabase, items): Promise<UpsertResult>
async function saveSteps(supabase, items): Promise<UpsertResult>
```

### sync_daily.ts

日次同期オーケストレーター。

```typescript
async function syncTanitaDaily(syncDays?: number): Promise<SyncResult>
```

### sync_all.ts

全件同期（初回移行・リカバリ用）。

```typescript
async function syncAllTanitaData(startDate: Date, endDate: Date): Promise<void>
```

---

## データベーススキーマ

### tanita スキーマ

| テーブル | 主キー | ユニーク制約 | 説明 |
|----------|--------|-------------|------|
| `tokens` | `id` (UUID) | - | OAuth2.0トークン |
| `body_composition` | `id` (UUID) | `measured_at` | 体重・体脂肪率 |
| `blood_pressure` | `id` (UUID) | `measured_at` | 血圧・脈拍 |
| `steps` | `id` (UUID) | `measured_at` | 歩数 |

---

## API仕様

### 認証方式

OAuth 2.0 Authorization Code Grant。トークンは `tanita.tokens` テーブルで管理。

### 制約・制限

| 項目 | 値 |
|------|-----|
| 最大取得期間 | 3ヶ月 |
| レート制限 | 60回/時間 |
| トークン有効期限 | 約30日 |

### 利用可能タグ

| タグID | 項目 |
|--------|------|
| 6021 | 体重 |
| 6022 | 体脂肪率 |
| 622E | 最高血圧 |
| 622F | 最低血圧 |
| 6230 | 脈拍 |
| 6331 | 歩数 |

※ 筋肉量、基礎代謝、内臓脂肪レベル等は2020/6/29で提供終了

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
# 全テスト実行（50件）
deno test test/tanita/ --allow-env --allow-read

# 個別実行
deno test test/tanita/api.test.ts --allow-env          # 11件: parseTanitaDate, formatTanitaDate
deno test test/tanita/auth.test.ts --allow-env         # 10件: isTokenExpiringSoon
deno test test/tanita/fetch_data.test.ts --allow-env   # 10件: generatePeriods
deno test test/tanita/write_db.test.ts --allow-env --allow-read  # 19件: toDb* 変換関数
```

### 手動統合テスト

```bash
# 認証テスト
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_auth.ts

# データ取得テスト（DB書き込みなし）
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_fetch.ts

# DB内容確認
deno run --allow-env --allow-net --allow-read test/tanita/manual/check_db.ts

# 同期テスト（DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_sync.ts
```

### テストファイル構成

```
test/tanita/
├── api.test.ts          # api.ts の純粋関数テスト
├── auth.test.ts         # auth.ts の純粋関数テスト
├── fetch_data.test.ts   # fetch_data.ts の純粋関数テスト
├── write_db.test.ts     # write_db.ts の変換関数テスト
└── manual/
    ├── README.md        # 手動テストの説明
    ├── test_auth.ts     # 認証フローテスト
    ├── test_fetch.ts    # API取得テスト
    ├── test_sync.ts     # 統合テスト（DB書き込み）
    └── check_db.ts      # DB内容確認
```

---

## GitHub Actions

定期実行は `sync-all.yml` に統合（毎日 JST 00:00）。

個別実行は `sync-tanita.yml` で手動トリガー可能。

---

## 初回セットアップ

1. [Tanita Health Planet](https://www.healthplanet.jp/) でアプリケーション登録

2. 認可URLにアクセスして認可コードを取得:
   ```
   https://www.healthplanet.jp/oauth/auth
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=https://www.healthplanet.jp/success.html
     &scope=innerscan,sphygmomanometer,pedometer
     &response_type=code
   ```

3. 初回トークン取得:
   ```bash
   deno run --allow-env --allow-net --allow-read auth.ts --init --code=YOUR_AUTH_CODE
   ```

4. 全件同期を実行:
   ```bash
   deno run --allow-env --allow-net --allow-read sync_all.ts
   ```
