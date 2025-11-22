# Fitbit同期モジュール

Fitbit Web APIからデータを取得し、Supabaseの`fitbit`スキーマに同期するモジュール群。

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        外部サービス                              │
├─────────────────────────────────────────────────────────────────┤
│  Fitbit Web API                   Supabase (fitbit スキーマ)    │
│  - /sleep                         - fitbit.tokens               │
│  - /activities                    - fitbit.sleep                │
│  - /heart                         - fitbit.activity_daily       │
│  - /hrv                           - fitbit.heart_rate_daily     │
│  - /spo2                          - fitbit.hrv_daily            │
│  - /br                            - fitbit.spo2_daily           │
│  - /cardioscore                   - fitbit.breathing_rate_daily │
│  - /temp/skin                     - fitbit.cardio_score_daily   │
│  - /active-zone-minutes           - fitbit.temperature_skin_daily│
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
| `types.ts` | API/DB型定義 | No |
| `auth.ts` | OAuth2.0トークン管理（リフレッシュ・DB操作） | Yes |
| `api.ts` | Fitbit Web APIクライアント | No |
| `fetch_data.ts` | データ取得オーケストレーション（期間分割・レート制限対応） | No |
| `write_db.ts` | DB書き込み（変換・upsert） | No |
| `sync_daily.ts` | 日次同期（直近N日間） | Yes |
| `sync_all.ts` | 全件同期（初回移行・リカバリ用） | Yes |

---

## モジュール境界

### types.ts

型定義とインターフェース。

```typescript
// API型
export interface SleepApiResponse { ... }
export interface ActivityDailySummary { ... }
export interface HeartRateTimeSeriesResponse { ... }
export interface HrvApiResponse { ... }
export interface Spo2ApiResponse { ... }
export interface BreathingRateApiResponse { ... }
export interface CardioScoreApiResponse { ... }
export interface TemperatureSkinApiResponse { ... }
export interface AzmApiResponse { ... }
export interface TokenResponse { ... }

// DB型
export interface DbToken { ... }
export interface DbSleep { ... }
export interface DbActivityDaily { ... }
export interface DbHeartRateDaily { ... }
export interface DbHrvDaily { ... }
export interface DbSpo2Daily { ... }
export interface DbBreathingRateDaily { ... }
export interface DbCardioScoreDaily { ... }
export interface DbTemperatureSkinDaily { ... }

// オプション・結果型
export interface AuthOptions { ... }
export interface FetchOptions { ... }
export interface SyncResult { ... }
export interface FitbitData { ... }
```

---

### auth.ts

OAuth2.0認証を管理。トークンはSupabase `fitbit.tokens`に保存。

```typescript
// 有効性チェック（DBの expires_at を参照、APIを叩かない）
export function isTokenExpiringSoon(expiresAt: Date, thresholdMinutes?: number): boolean

// リフレッシュ実行（APIを叩く）
export async function refreshTokenFromApi(refreshToken: string): Promise<TokenResponse>

// メイン関数: 有効なアクセストークンを保証
export async function ensureValidToken(options?: AuthOptions): Promise<string>
```

**CLI使用法**:
```bash
# 有効性確認（必要ならリフレッシュ）
deno run --allow-env --allow-net --allow-read auth.ts

# 強制リフレッシュ
deno run --allow-env --allow-net --allow-read auth.ts --refresh
```

---

### api.ts

Fitbit Web APIのエンドポイントをラップ。

```typescript
export class FitbitAPI {
  constructor(accessToken: string)

  // Sleep
  async getSleepByDateRange(startDate: Date, endDate: Date): Promise<SleepApiResponse>
  async getSleepByDate(date: Date): Promise<SleepApiResponse>

  // Activity
  async getActivityDailySummary(date: Date): Promise<ActivityDailySummary>

  // Heart Rate
  async getHeartRateByDateRange(startDate: Date, endDate: Date): Promise<HeartRateTimeSeriesResponse>
  async getHeartRateIntraday(date: Date): Promise<HeartRateTimeSeriesResponse>

  // HRV
  async getHrvByDateRange(startDate: Date, endDate: Date): Promise<HrvApiResponse>
  async getHrvIntraday(date: Date): Promise<HrvApiResponse>

  // SpO2
  async getSpo2ByDate(date: Date): Promise<Spo2ApiResponse>
  async getSpo2ByDateRange(startDate: Date, endDate: Date): Promise<Spo2ApiResponse[]>

  // Breathing Rate
  async getBreathingRateByDateRange(startDate: Date, endDate: Date): Promise<BreathingRateApiResponse>

  // Cardio Score (VO2 Max)
  async getCardioScoreByDateRange(startDate: Date, endDate: Date): Promise<CardioScoreApiResponse>

  // Temperature Skin
  async getTemperatureSkinByDateRange(startDate: Date, endDate: Date): Promise<TemperatureSkinApiResponse>

  // Active Zone Minutes
  async getAzmByDateRange(startDate: Date, endDate: Date): Promise<AzmApiResponse>
}

// ヘルパー
export function formatFitbitDate(date: Date): string      // Date → YYYY-MM-DD
export function parseFitbitDate(dateStr: string): Date    // YYYY-MM-DD → Date (UTC)
```

---

### fetch_data.ts

レート制限と期間制約を考慮したデータ取得オーケストレーション。

```typescript
export interface FitbitData {
  sleep: SleepLog[];
  activity: Map<string, ActivitySummary>;
  heartRate: HeartRateDay[];
  heartRateIntraday: Map<string, HeartRateIntraday>;
  hrv: HrvDay[];
  spo2: Map<string, Spo2ApiResponse>;
  breathingRate: BreathingRateDay[];
  cardioScore: CardioScoreDay[];
  temperatureSkin: TemperatureSkinDay[];
  azm: AzmDay[];
}

// 日付リスト生成
export function generateDateRange(startDate: Date, endDate: Date): Date[]

// 期間を最大日数でチャンク分割
export function generatePeriods(startDate: Date, endDate: Date, maxDays: number): Array<{ from: Date; to: Date }>

// メイン関数
export async function fetchFitbitData(accessToken: string, options?: FetchOptions): Promise<FitbitData>
```

---

### write_db.ts

Supabase `fitbit`スキーマへの書き込み。

```typescript
// Supabaseクライアント
export function createFitbitDbClient(): SupabaseClient

// 変換関数: API → DB レコード
export function toDbSleep(items: SleepLog[]): DbSleep[]
export function toDbActivityDaily(activityMap, azmData, intradayMap?): DbActivityDaily[]
export function toDbHeartRateDaily(items, intradayMap?): DbHeartRateDaily[]
export function toDbHrvDaily(items: HrvDay[]): DbHrvDaily[]
export function toDbSpo2Daily(spo2Map): DbSpo2Daily[]
export function toDbBreathingRateDaily(items): DbBreathingRateDaily[]
export function toDbCardioScoreDaily(items): DbCardioScoreDaily[]
export function toDbTemperatureSkinDaily(items): DbTemperatureSkinDaily[]

// 保存関数
export async function saveSleep(supabase, items): Promise<UpsertResult>
export async function saveActivityDaily(supabase, activityMap, azmData): Promise<UpsertResult>
export async function saveHeartRateDaily(supabase, items, intradayMap?): Promise<UpsertResult>
export async function saveHrvDaily(supabase, items): Promise<UpsertResult>
export async function saveSpo2Daily(supabase, spo2Map): Promise<UpsertResult>
export async function saveBreathingRateDaily(supabase, items): Promise<UpsertResult>
export async function saveCardioScoreDaily(supabase, items): Promise<UpsertResult>
export async function saveTemperatureSkinDaily(supabase, items): Promise<UpsertResult>
export async function saveAllFitbitData(supabase, data: FitbitData): Promise<AllResults>
```

---

### sync_daily.ts

日次同期オーケストレーター。

```typescript
export async function syncFitbitDaily(syncDays?: number): Promise<SyncResult>
```

---

### sync_all.ts

全件同期（初回移行・リカバリ用）。

```typescript
export async function syncAllFitbitData(startDate: Date, endDate: Date, includeIntraday?: boolean): Promise<void>
```

---

## データフロー

### 日次同期 (sync_daily.ts)

```
ensureValidToken() ──► accessToken
        │
        ▼
fetchFitbitData() ──► FitbitData ──► write_db ──► Supabase
        │                                │
        ▼                                ▼
   Fitbit Web API                  fitbit.* tables
   (8種類のエンドポイント)
```

### 全件同期 (sync_all.ts)

```
syncAllFitbitData(startDate, endDate, includeIntraday)
        │
        ├──► ensureValidToken()
        │
        ├──► fetchFitbitData() ──► Fitbit API
        │         (期間分割: Sleep 100日, Temp 30日)
        │
        └──► saveAllFitbitData() ──► Supabase
```

---

## Supabaseスキーマ

### fitbit スキーマ

| テーブル | 主キー | ユニーク制約 | 説明 |
|----------|--------|-------------|------|
| `tokens` | `id` (UUID) | - | OAuth2.0トークン |
| `sleep` | `id` (UUID) | `log_id` | 睡眠記録（レコード単位） |
| `activity_daily` | `id` (UUID) | `date` | 日次活動サマリー |
| `heart_rate_daily` | `id` (UUID) | `date` | 日次心拍データ |
| `hrv_daily` | `id` (UUID) | `date` | 日次HRVデータ |
| `spo2_daily` | `id` (UUID) | `date` | 日次SpO2データ |
| `breathing_rate_daily` | `id` (UUID) | `date` | 日次呼吸数データ |
| `cardio_score_daily` | `id` (UUID) | `date` | 日次VO2 Maxデータ |
| `temperature_skin_daily` | `id` (UUID) | `date` | 日次皮膚温度データ |

---

## 実行例

```bash
# 認証確認（必要ならリフレッシュ）
deno run --allow-env --allow-net --allow-read auth.ts

# 強制リフレッシュ
deno run --allow-env --allow-net --allow-read auth.ts --refresh

# 日次同期（直近7日間、デフォルト）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近30日間）
FITBIT_SYNC_DAYS=30 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（デフォルト: 過去1年）
deno run --allow-env --allow-net --allow-read sync_all.ts

# 全件同期（特定期間）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

# 全件同期（Intradayデータ込み）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-11-01 --end=2024-11-30 --intraday
```

---

## 環境変数一覧

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `FITBIT_CLIENT_ID` | Yes | Fitbit OAuth Client ID |
| `FITBIT_CLIENT_SECRET` | Yes | Fitbit OAuth Client Secret |
| `FITBIT_SYNC_DAYS` | No | 同期日数（sync_daily.ts用、デフォルト: 3） |

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

---

## Fitbit API 制約

| 項目 | 値 |
|------|-----|
| レート制限 | 150リクエスト/時間 |
| トークン有効期限 | 8時間 |
| Sleep取得期間 | 最大100日 |
| Temperature取得期間 | 最大30日 |
| Intraday粒度 | HR: 1秒/1分, HRV: 5分 |
| API呼び出し間隔 | 500ms（本モジュール設定） |

---

## 取得データタイプ

| データ | エンドポイント | 粒度 | JSONB格納 |
|--------|--------------|------|----------|
| 睡眠 | `/1.2/user/-/sleep` | レコード | levels |
| 活動 | `/1/user/-/activities` | 日次 | active_zone_minutes, intraday |
| 心拍 | `/1/user/-/activities/heart` | 日次 | heart_rate_zones, intraday |
| HRV | `/1/user/-/hrv` | 日次 | intraday（5分粒度） |
| SpO2 | `/1/user/-/spo2` | 日次 | intraday |
| 呼吸数 | `/1/user/-/br` | 日次 | intraday |
| VO2 Max | `/1/user/-/cardioscore` | 日次 | - |
| 皮膚温度 | `/1/user/-/temp/skin` | 日次 | - |
| AZM | `/1/user/-/activities/active-zone-minutes` | 日次 | - |

---

## Inspire 3 対応状況

| 機能 | 対応 | 備考 |
|------|-----|------|
| 睡眠 | ✓ | ステージ（deep/light/rem/wake） |
| 歩数・活動 | ✓ | |
| 心拍 | ✓ | 安静時HR、ゾーン |
| HRV | ✓ | 睡眠中のみ |
| SpO2 | ✓ | 睡眠中のみ |
| 呼吸数 | ✓ | 睡眠中のみ |
| VO2 Max | ✓ | |
| 皮膚温度 | △ | 相対値のみ、条件厳しい |
| ECG | ✗ | センサーなし |
| GPS | ✗ | Connected GPSのみ |

---

## 初回セットアップ

1. [Fitbit Developer](https://dev.fitbit.com/)でアプリケーション登録
   - Application Type: **Personal**（自分のデータのみ）
   - OAuth 2.0 Application Type: **Personal**
   - Callback URL: 適宜設定（例: `http://localhost:8080/callback`）

2. OAuth認可フローでトークンを取得:
   ```
   https://www.fitbit.com/oauth2/authorize?response_type=code
     &client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_CALLBACK_URL
     &scope=activity+heartrate+location+nutrition+oxygen_saturation+profile+respiratory_rate+settings+sleep+social+temperature+weight
     &expires_in=28800
   ```

3. 認可コードをトークンに交換:
   ```bash
   curl -X POST https://api.fitbit.com/oauth2/token \
     -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=YOUR_CALLBACK_URL"
   ```

4. トークンを`fitbit.tokens`テーブルに保存

5. 環境変数を設定

6. 全件同期を実行:
   ```bash
   deno run --allow-env --allow-net --allow-read sync_all.ts
   ```

---

## GitHub Actions での自動同期

```yaml
name: Fitbit Sync Daily

on:
  schedule:
    - cron: '0 0 * * *'  # UTC 00:00 (JST 09:00)
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x

      - name: Run Fitbit Sync
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          FITBIT_CLIENT_ID: ${{ secrets.FITBIT_CLIENT_ID }}
          FITBIT_CLIENT_SECRET: ${{ secrets.FITBIT_CLIENT_SECRET }}
        run: |
          cd src/services/fitbit
          deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## テスト

### 単体テスト

```bash
# 全テスト実行
deno test test/fitbit/ --allow-env --allow-read

# 個別実行
deno test test/fitbit/api.test.ts --allow-env          # formatFitbitDate, parseFitbitDate
deno test test/fitbit/auth.test.ts --allow-env         # isTokenExpiringSoon
deno test test/fitbit/fetch_data.test.ts --allow-env   # generateDateRange, generatePeriods
deno test test/fitbit/write_db.test.ts --allow-env --allow-read  # toDb* 変換関数
```

### 手動統合テスト

```bash
# 1. 認証テスト
deno run --allow-env --allow-net --allow-read auth.ts

# 2. 日次同期テスト（3日間）
FITBIT_SYNC_DAYS=3 deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## 注意事項

- Fitbit APIのレート制限は150リクエスト/時間です
- 長期間の同期は時間がかかります（1日あたり約10リクエスト）
- Intradayデータは1日ずつ取得するため、さらに時間がかかります
- トークンは8時間で期限切れになるため、長時間の同期では途中でリフレッシュが必要になる場合があります
