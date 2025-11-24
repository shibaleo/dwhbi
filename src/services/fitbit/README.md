# Fitbit 同期モジュール

Fitbit Web API からヘルスデータを取得し、Supabase `fitbit` スキーマに同期する。

## クイックスタート

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `FITBIT_CLIENT_ID` | Yes | Fitbit OAuth Client ID |
| `FITBIT_CLIENT_SECRET` | Yes | Fitbit OAuth Client Secret |
| `FITBIT_SYNC_DAYS` | No | 同期日数（デフォルト: 3） |

### 実行コマンド

```bash
# 日次同期（直近3日間）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近30日間）
FITBIT_SYNC_DAYS=30 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（過去1年）
deno run --allow-env --allow-net --allow-read sync_all.ts

# 全件同期（期間指定）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31

# 認証確認・強制リフレッシュ
deno run --allow-env --allow-net --allow-read auth.ts --refresh
```

---

## アーキテクチャ

### データパイプライン

```
Fitbit Web API              変換                    Supabase
──────────────────────────────────────────────────────────────
/sleep              →  toDbSleep()            →  fitbit.sleep
/activities         →  toDbActivityDaily()    →  fitbit.activity_daily
/heart              →  toDbHeartRateDaily()   →  fitbit.heart_rate_daily
/hrv                →  toDbHrvDaily()         →  fitbit.hrv_daily
/spo2               →  toDbSpo2Daily()        →  fitbit.spo2_daily
/br                 →  toDbBreathingRateDaily()→ fitbit.breathing_rate_daily
/cardioscore        →  toDbCardioScoreDaily() →  fitbit.cardio_score_daily
/temp/skin          →  toDbTemperatureSkinDaily()→fitbit.temperature_skin_daily
```

### ファイル構成

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

## モジュール詳細

### types.ts

API型・DB型・オプション型を定義。

```typescript
// API型
interface SleepApiResponse { ... }
interface ActivityDailySummary { ... }
interface HeartRateTimeSeriesResponse { ... }
interface HrvApiResponse { ... }
interface Spo2ApiResponse { ... }
interface BreathingRateApiResponse { ... }
interface CardioScoreApiResponse { ... }
interface TemperatureSkinApiResponse { ... }
interface TokenResponse { ... }

// DB型
interface DbSleep { ... }
interface DbActivityDaily { ... }
interface DbHeartRateDaily { ... }
interface DbHrvDaily { ... }
interface DbSpo2Daily { ... }
interface DbBreathingRateDaily { ... }
interface DbCardioScoreDaily { ... }
interface DbTemperatureSkinDaily { ... }

// オプション型
interface AuthOptions { ... }
interface FetchOptions { ... }
interface SyncResult { ... }
```

### auth.ts

OAuth2.0認証管理。トークンは `fitbit.tokens` に保存。

```typescript
// 有効性チェック（APIを叩かない）
function isTokenExpiringSoon(expiresAt: Date, thresholdMinutes?: number): boolean

// リフレッシュ実行
async function refreshTokenFromApi(refreshToken: string): Promise<TokenResponse>

// メイン関数: 有効なアクセストークンを保証
async function ensureValidToken(options?: AuthOptions): Promise<string>
```

### api.ts

Fitbit Web APIクライアント。

```typescript
class FitbitAPI {
  constructor(accessToken: string)
  
  // 各エンドポイント
  async getSleepByDateRange(startDate: Date, endDate: Date): Promise<SleepApiResponse>
  async getActivityDailySummary(date: Date): Promise<ActivityDailySummary>
  async getHeartRateByDateRange(startDate: Date, endDate: Date): Promise<HeartRateTimeSeriesResponse>
  async getHrvByDateRange(startDate: Date, endDate: Date): Promise<HrvApiResponse>
  async getSpo2ByDateRange(startDate: Date, endDate: Date): Promise<Spo2ApiResponse[]>
  async getBreathingRateByDateRange(startDate: Date, endDate: Date): Promise<BreathingRateApiResponse>
  async getCardioScoreByDateRange(startDate: Date, endDate: Date): Promise<CardioScoreApiResponse>
  async getTemperatureSkinByDateRange(startDate: Date, endDate: Date): Promise<TemperatureSkinApiResponse>
}

// ヘルパー
function formatFitbitDate(date: Date): string   // → YYYY-MM-DD
function parseFitbitDate(dateStr: string): Date // → Date (UTC)
```

### fetch_data.ts

レート制限・期間制約を考慮したデータ取得。

```typescript
interface FitbitData {
  sleep: SleepLog[];
  activity: Map<string, ActivitySummary>;
  heartRate: HeartRateDay[];
  hrv: HrvDay[];
  spo2: Map<string, Spo2ApiResponse>;
  breathingRate: BreathingRateDay[];
  cardioScore: CardioScoreDay[];
  temperatureSkin: TemperatureSkinDay[];
}

// 期間をチャンク分割
function generatePeriods(startDate: Date, endDate: Date, maxDays: number): Array<{ from: Date; to: Date }>

// メイン関数
async function fetchFitbitData(accessToken: string, options?: FetchOptions): Promise<FitbitData>
```

### write_db.ts

Supabase `fitbit` スキーマへの書き込み。

```typescript
// 変換関数: API → DB
function toDbSleep(items: SleepLog[]): DbSleep[]
function toDbActivityDaily(activityMap, azmData): DbActivityDaily[]
function toDbHeartRateDaily(items): DbHeartRateDaily[]
function toDbHrvDaily(items): DbHrvDaily[]
function toDbSpo2Daily(spo2Map): DbSpo2Daily[]
function toDbBreathingRateDaily(items): DbBreathingRateDaily[]
function toDbCardioScoreDaily(items): DbCardioScoreDaily[]
function toDbTemperatureSkinDaily(items): DbTemperatureSkinDaily[]

// 保存関数
async function saveAllFitbitData(supabase, data: FitbitData): Promise<AllResults>
```

### sync_daily.ts

日次同期オーケストレーター。

```typescript
async function syncFitbitDaily(syncDays?: number): Promise<SyncResult>
```

### sync_all.ts

全件同期（初回移行・リカバリ用）。

```typescript
async function syncAllFitbitData(startDate: Date, endDate: Date, includeIntraday?: boolean): Promise<void>
```

---

## データベーススキーマ

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

## API仕様

### 認証方式

OAuth 2.0 Authorization Code Grant。トークンは `fitbit.tokens` テーブルで管理。

### 制約・制限

| 項目 | 値 |
|------|-----|
| レート制限 | 150リクエスト/時間 |
| トークン有効期限 | 8時間 |
| Sleep取得期間 | 最大100日 |
| Temperature取得期間 | 最大30日 |
| Intraday粒度 | HR: 1秒/1分, HRV: 5分 |
| API呼び出し間隔 | 500ms（本モジュール設定） |

### 取得データタイプ

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
deno test test/fitbit/ --allow-env --allow-read

# 個別実行
deno test test/fitbit/api.test.ts --allow-env          # formatFitbitDate, parseFitbitDate
deno test test/fitbit/auth.test.ts --allow-env         # isTokenExpiringSoon
deno test test/fitbit/fetch_data.test.ts --allow-env   # generateDateRange, generatePeriods
deno test test/fitbit/write_db.test.ts --allow-env --allow-read  # toDb* 変換関数
```

### 手動統合テスト

```bash
# 認証テスト
deno run --allow-env --allow-net --allow-read auth.ts

# 日次同期テスト（3日間）
FITBIT_SYNC_DAYS=3 deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## GitHub Actions

定期実行は `sync-all.yml` に統合（毎日 JST 00:00）。

個別実行は `sync-fitbit.yml` で手動トリガー可能。

---

## 初回セットアップ

1. [Fitbit Developer](https://dev.fitbit.com/) でアプリケーション登録
   - Application Type: **Personal**
   - OAuth 2.0 Application Type: **Personal**

2. 認可URLにアクセス:
   ```
   https://www.fitbit.com/oauth2/authorize?response_type=code
     &client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_CALLBACK_URL
     &scope=activity+heartrate+oxygen_saturation+respiratory_rate+sleep+temperature
   ```

3. 認可コードをトークンに交換:
   ```bash
   curl -X POST https://api.fitbit.com/oauth2/token \
     -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \
     -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=CALLBACK_URL"
   ```

4. トークンを `fitbit.tokens` に保存

5. 全件同期を実行:
   ```bash
   deno run --allow-env --allow-net --allow-read sync_all.ts
   ```

---

## デバイス対応状況（Inspire 3）

| 機能 | 対応 | 備考 |
|------|-----|------|
| 睡眠 | ✓ | ステージ（deep/light/rem/wake） |
| 歩数・活動 | ✓ | |
| 心拍 | ✓ | 安静時HR、ゾーン |
| HRV | ✓ | 睡眠中のみ |
| SpO2 | ✓ | 睡眠中のみ |
| 呼吸数 | ✓ | 睡眠中のみ |
| VO2 Max | ✓ | |
| 皮膚温度 | △ | 相対値のみ |
| ECG | ✗ | センサーなし |
| GPS | ✗ | Connected GPSのみ |

---

## DWH移行計画

### 概要

現在の `fitbit` スキーマを `raw` スキーマに移行し、DWH 3層アーキテクチャを採用する。

```
現在:  fitbit.sleep, fitbit.activity_daily, fitbit.heart_rate_daily, ...
    ↓
移行後:
  raw.fitbit_sleep              ← 生データ（テーブル）
  raw.fitbit_activity_daily
  raw.fitbit_heart_rate_daily
  raw.fitbit_hrv_daily
  raw.fitbit_spo2_daily
  raw.fitbit_breathing_rate_daily
  raw.fitbit_cardio_score_daily
  raw.fitbit_temperature_skin_daily
      ↓
  staging.stg_fitbit__sleep     ← クリーニング済み（ビュー）
  staging.stg_fitbit__activity_daily
      ↓
  marts.fct_daily_health        ← ビジネスエンティティ（ビュー）
```

### 変更点

| 項目 | 現在 | 移行後 |
|------|------|--------|
| スキーマ | `fitbit` | `raw` |
| テーブル名 | `sleep` | `fitbit_sleep` |
| DBクライアント | supabase-js (REST API) | postgres.js (直接接続) |
| API公開 | Exposed | Not Exposed |

### write_db.ts 変更内容

```typescript
// 現在
import { createClient } from "npm:@supabase/supabase-js@2";
const supabase = createClient(url, key);
const fitbit = supabase.schema("fitbit");
await fitbit.from("sleep").upsert(data, { onConflict: "log_id" });

// 移行後
import postgres from "npm:postgres";
const sql = postgres(DATABASE_URL);
await sql`
  INSERT INTO raw.fitbit_sleep ${sql(records)}
  ON CONFLICT (log_id) DO UPDATE SET
    duration_ms = EXCLUDED.duration_ms,
    efficiency = EXCLUDED.efficiency,
    levels = EXCLUDED.levels,
    synced_at = now()
`;
```

### 環境変数追加

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | PostgreSQL 直接接続文字列 |

### マイグレーション手順

1. `raw.fitbit_*` テーブルを作成
2. `fitbit.*` から `raw.fitbit_*` にデータ移行
3. `write_db.ts` を postgres.js に書き換え
4. `staging.stg_fitbit__*` ビューを作成
5. 旧 `fitbit` スキーマを削除（データ確認後）

### OAuthトークンの保存場所

`fitbit.tokens` テーブルは raw 層ではなく、別途 `auth` スキーマまたは環境変数での管理を検討。
