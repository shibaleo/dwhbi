---
title: Fitbit コネクタ設計
description: Fitbit Web API との連携設計
---

# Fitbit コネクタ設計

## 概要

Fitbit Web API からデータを取得し、PostgreSQL raw 層に保存するコネクタ。

| 項目 | 値 |
|------|-----|
| パッケージ | `@repo/connector/fitbit` |
| 認証方式 | OAuth 2.0 (Refresh Token) |
| API バージョン | Fitbit Web API v1 / v1.2 |
| 認証情報保存 | PostgreSQL Vault (`vault.secrets`) |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      cli.ts                                  │
│                    (エントリポイント)                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    orchestrator.ts                           │
│                   (同期オーケストレーター)                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ getDbClient() → syncSleep()                             ││
│  │              → syncActivity()                           ││
│  │              → syncHeartRate()                          ││
│  │              → syncHrv()                                ││
│  │              → syncSpo2()                               ││
│  │              → syncBreathingRate()                      ││
│  │              → syncCardioScore()                        ││
│  │              → syncTemperatureSkin()                    ││
│  │              → closeDbClient()                          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
┌───▼───────────┐   ┌─────▼─────────┐   ┌──────▼──────────┐
│ sync-sleep.ts │   │ sync-daily.ts │   │ sync-intraday.ts│
│ (睡眠ログ)     │   │ (日次サマリー) │   │ (詳細データ)     │
└───────────────┘   └───────────────┘   └─────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    api-client.ts                             │
│                   (API通信・OAuth)                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ getAuthInfo() - トークン自動リフレッシュ                  ││
│  │ fetchSleep(), fetchActivity(), fetchHeartRate()         ││
│  │ fetchHrv(), fetchSpo2(), fetchBreathingRate()           ││
│  │ fetchCardioScore(), fetchTemperatureSkin()              ││
│  │ requestWithRetry() - レートリミット対応                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  credentials-vault.ts                        │
│                 (Vault 認証情報管理)                         │
└─────────────────────────────────────────────────────────────┘
```

## データフロー

### 同期処理フロー

```
1. CLI起動 (--days オプション)
2. DB接続確立 (getDbClient)
3. 認証情報取得・トークンリフレッシュ（必要に応じて）
4. データ同期 (順次実行 - レートリミット考慮)
   - sleep (睡眠ログ)
   - activity (日次活動サマリー)
   - heart_rate (日次心拍数)
   - hrv (心拍変動)
   - spo2 (血中酸素飽和度)
   - breathing_rate (呼吸数)
   - cardio_score (心肺機能スコア)
   - temperature_skin (皮膚温度)
5. DB接続クローズ (closeDbClient)
```

### 認証フロー

```
1. getAuthInfo() 呼び出し
2. キャッシュ確認 (有効期限60分以上なら返却)
3. Vault から認証情報取得
4. トークン有効期限チェック
   - 有効期限切れまたは60分以内 → リフレッシュ
5. リフレッシュ実行
   - Fitbit OAuth endpoint に refresh_token 送信
   - 新しい access_token 取得 (有効期限: 8時間)
   - Vault 更新 (access_token, refresh_token, _expires_at)
6. キャッシュに保存
```

## API エンドポイント

### Fitbit Web API

| エンドポイント | メソッド | 用途 | チャンク制限 |
|--------------|---------|------|------------|
| `/1.2/user/-/sleep/date/{start}/{end}.json` | GET | 睡眠ログ | 100日 |
| `/1/user/-/activities/date/{date}.json` | GET | 日次活動サマリー | 1日 |
| `/1/user/-/activities/heart/date/{start}/{end}.json` | GET | 日次心拍数 | 30日 |
| `/1/user/-/hrv/date/{start}/{end}.json` | GET | HRV | 30日 |
| `/1/user/-/spo2/date/{start}/{end}.json` | GET | SpO2 | 30日 |
| `/1/user/-/br/date/{start}/{end}.json` | GET | 呼吸数 | 30日 |
| `/1/user/-/cardioscore/date/{start}/{end}.json` | GET | 心肺機能スコア | 30日 |
| `/1/user/-/temp/skin/date/{start}/{end}.json` | GET | 皮膚温度 | 30日 |

### OAuth

| エンドポイント | 用途 |
|--------------|------|
| `https://api.fitbit.com/oauth2/token` | トークンリフレッシュ |

### レート制限

| 制限 | 値 |
|------|-----|
| リクエスト数 | 150 requests/hour (ユーザーごと) |
| 429エラー時 | Retry-After ヘッダー参照 |

## raw テーブル

既存テーブルを削除し、JSONB パターンに統一する。

### 変更前 (既存テーブル - 削除対象)

| テーブル名 | レコード数 | 期間 |
|-----------|----------|------|
| `raw.fitbit_sleep` | 104 | 2020-06-21 ~ 2025-12-03 |
| `raw.fitbit_activity_daily` | 219 | 2020-04-15 ~ 2025-12-04 |
| `raw.fitbit_heart_rate_daily` | 109 | 2020-06-01 ~ 2025-12-04 |
| `raw.fitbit_hrv_daily` | 18 | 2025-11-16 ~ 2025-12-03 |
| `raw.fitbit_spo2_daily` | 18 | 2025-11-16 ~ 2025-12-03 |
| `raw.fitbit_breathing_rate_daily` | 15 | 2025-11-16 ~ 2025-11-30 |
| `raw.fitbit_cardio_score_daily` | 89 | 2020-06-20 ~ 2025-12-01 |
| `raw.fitbit_temperature_skin_daily` | 16 | 2020-08-18 ~ 2025-11-30 |

### 変更後 (新テーブル)

| テーブル名 | source_id | 説明 |
|-----------|-----------|------|
| `raw.fitbit__sleep` | `{log_id}` | 睡眠ログ (log_id でユニーク) |
| `raw.fitbit__activity` | `{date}` | 日次活動サマリー |
| `raw.fitbit__heart_rate` | `{date}` | 日次心拍数 |
| `raw.fitbit__hrv` | `{date}` | 心拍変動 |
| `raw.fitbit__spo2` | `{date}` | 血中酸素飽和度 |
| `raw.fitbit__breathing_rate` | `{date}` | 呼吸数 |
| `raw.fitbit__cardio_score` | `{date}` | 心肺機能スコア |
| `raw.fitbit__temperature_skin` | `{date}` | 皮膚温度 |

### 新テーブル定義

```sql
-- 睡眠ログ (log_id でユニーク)
CREATE TABLE raw.fitbit__sleep (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- log_id
    data JSONB NOT NULL,              -- API レスポンス全体
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1.2'
);

CREATE INDEX idx_fitbit_sleep_synced_at ON raw.fitbit__sleep(synced_at);

-- 日次活動サマリー (日付でユニーク)
CREATE TABLE raw.fitbit__activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_activity_synced_at ON raw.fitbit__activity(synced_at);

-- 日次心拍数 (日付でユニーク)
CREATE TABLE raw.fitbit__heart_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_heart_rate_synced_at ON raw.fitbit__heart_rate(synced_at);

-- HRV (日付でユニーク)
CREATE TABLE raw.fitbit__hrv (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_hrv_synced_at ON raw.fitbit__hrv(synced_at);

-- SpO2 (日付でユニーク)
CREATE TABLE raw.fitbit__spo2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_spo2_synced_at ON raw.fitbit__spo2(synced_at);

-- 呼吸数 (日付でユニーク)
CREATE TABLE raw.fitbit__breathing_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_breathing_rate_synced_at ON raw.fitbit__breathing_rate(synced_at);

-- 心肺機能スコア (日付でユニーク)
CREATE TABLE raw.fitbit__cardio_score (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_cardio_score_synced_at ON raw.fitbit__cardio_score(synced_at);

-- 皮膚温度 (日付でユニーク)
CREATE TABLE raw.fitbit__temperature_skin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_fitbit_temperature_skin_synced_at ON raw.fitbit__temperature_skin(synced_at);
```

### source_id 形式

| データ型 | source_id | 例 |
|---------|-----------|-----|
| 睡眠ログ | log_id (文字列) | `"7025169603619898000"` |
| 日次データ | YYYY-MM-DD | `"2025-12-01"` |

### data JSONB 構造

**睡眠 (sleep)**:

```json
{
  "log_id": "7025169603619898000",
  "date": "2025-11-20",
  "start_time": "2025-11-20T00:27:00.000",
  "end_time": "2025-11-20T07:03:30.000",
  "duration_ms": 23760000,
  "efficiency": 80,
  "is_main_sleep": true,
  "minutes_asleep": 318,
  "minutes_awake": 78,
  "time_in_bed": 396,
  "sleep_type": "stages",
  "levels": {
    "data": [...],
    "summary": {
      "rem": { "count": 7, "minutes": 74, "thirtyDayAvgMinutes": 93 },
      "deep": { "count": 7, "minutes": 81, "thirtyDayAvgMinutes": 93 },
      "wake": { "count": 20, "minutes": 78, "thirtyDayAvgMinutes": 46 },
      "light": { "count": 22, "minutes": 162, "thirtyDayAvgMinutes": 213 }
    },
    "shortData": [...]
  },
  "_start_time_utc": "2025-11-19T15:27:00.000Z",
  "_end_time_utc": "2025-11-19T22:03:30.000Z"
}
```

**日次活動 (activity_daily)**:

```json
{
  "date": "2025-12-01",
  "steps": 8532,
  "distance_km": 6.5,
  "floors": 10,
  "calories_total": 2150,
  "calories_bmr": 1727,
  "calories_activity": 423,
  "sedentary_minutes": 720,
  "lightly_active_minutes": 180,
  "fairly_active_minutes": 30,
  "very_active_minutes": 15,
  "active_zone_minutes": { "fatBurn": 20, "cardio": 10, "peak": 5 },
  "intraday": null
}
```

**日次心拍数 (heart_rate_daily)**:

```json
{
  "date": "2025-12-01",
  "resting_heart_rate": 62,
  "heart_rate_zones": [
    { "name": "Out of Range", "min": 30, "max": 91, "minutes": 1380, "caloriesOut": 1500 },
    { "name": "Fat Burn", "min": 91, "max": 127, "minutes": 45, "caloriesOut": 300 },
    { "name": "Cardio", "min": 127, "max": 154, "minutes": 10, "caloriesOut": 100 },
    { "name": "Peak", "min": 154, "max": 220, "minutes": 5, "caloriesOut": 50 }
  ],
  "intraday": null
}
```

**HRV (hrv_daily)**:

```json
{
  "date": "2025-12-01",
  "daily_rmssd": 42.5,
  "deep_rmssd": 58.3,
  "intraday": [...]
}
```

**SpO2 (spo2_daily)**:

```json
{
  "date": "2025-12-01",
  "avg_spo2": 96.5,
  "min_spo2": 94.0,
  "max_spo2": 99.0,
  "intraday": [...]
}
```

**呼吸数 (breathing_rate_daily)**:

```json
{
  "date": "2025-12-01",
  "breathing_rate": 14.5,
  "intraday": [...]
}
```

**心肺機能スコア (cardio_score_daily)**:

```json
{
  "date": "2025-12-01",
  "vo2_max": 45.0,
  "vo2_max_range_low": 42.0,
  "vo2_max_range_high": 48.0
}
```

**皮膚温度 (temperature_skin_daily)**:

```json
{
  "date": "2025-12-01",
  "nightly_relative": 0.5,
  "log_type": "scheduled"
}
```

## 日時変換

Fitbit API はタイムゾーン情報なしの ISO8601 文字列を返す。JST として扱い UTC に変換する。

```typescript
function convertJstToUtc(jstTimeStr: string): string {
  // "2025-11-20T00:27:00.000" (タイムゾーンなし、JST として解釈)
  const jstDate = new Date(jstTimeStr + "+09:00");
  return jstDate.toISOString();
}
// 例: "2025-11-20T00:27:00.000" → "2025-11-19T15:27:00.000Z"
```

## Vault 認証情報

```json
{
  "client_id": "xxxxx",
  "client_secret": "xxxxx",
  "refresh_token": "xxxxx",
  "access_token": "xxxxx",
  "_auth_type": "oauth2",
  "_expires_at": "2025-01-01T11:00:00.000Z"
}
```

| フィールド | 必須 | 説明 |
|-----------|-----|------|
| `client_id` | ○ | OAuth クライアント ID |
| `client_secret` | ○ | OAuth クライアントシークレット |
| `refresh_token` | ○ | リフレッシュトークン (更新される) |
| `access_token` | ○ | アクセストークン (自動更新) |
| `_auth_type` | ○ | `"oauth2"` 固定 |
| `_expires_at` | △ | トークン有効期限 (自動更新) |

## トークンリフレッシュ

### 自動リフレッシュ条件

- `_expires_at` が未設定
- 現在時刻から有効期限まで60分以内
- `forceRefresh = true` で呼び出し

### リフレッシュ処理

```typescript
const DEFAULT_THRESHOLD_MINUTES = 60;

const response = await fetch("https://api.fitbit.com/oauth2/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Authorization": `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`,
  },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
  }),
});

// 新しいトークンの有効期限は 8 時間
const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

// Vault 更新 (refresh_token も新しくなる)
await updateCredentials("fitbit", {
  access_token: newToken.access_token,
  refresh_token: newToken.refresh_token,
}, expiresAt);
```

## エラーハンドリング

| エラー | 対応 |
|--------|------|
| 401 Unauthorized | トークンリフレッシュ → リトライ |
| 429 Too Many Requests | Retry-After 待機 → リトライ |
| 400 Token refresh error | リフレッシュトークン失効 → エラー終了 (再認証必要) |
| 5xx Server Error | 1秒待機 → 1回リトライ → エラー終了 |

## 使用例

### CLI

```bash
# デフォルト 30日分
npm run sync:fitbit

# 90日分
npm run sync:fitbit -- --days 90

# 本番環境向け（ログ最小限）
npm run sync:fitbit -- --log-level warn
```

### ライブラリ

```typescript
import { syncAll } from "@repo/connector/fitbit";

const result = await syncAll({ days: 30 });
console.log(result.sleepCount);
console.log(result.activityCount);
```

## マイグレーション計画

### Phase 1: 新テーブル作成

```sql
-- 新テーブル作成
CREATE TABLE raw.fitbit__sleep (...);
CREATE TABLE raw.fitbit__activity_daily (...);
CREATE TABLE raw.fitbit__heart_rate_daily (...);
CREATE TABLE raw.fitbit__hrv_daily (...);
CREATE TABLE raw.fitbit__spo2_daily (...);
CREATE TABLE raw.fitbit__breathing_rate_daily (...);
CREATE TABLE raw.fitbit__cardio_score_daily (...);
CREATE TABLE raw.fitbit__temperature_skin_daily (...);
```

### Phase 2: データ移行

```sql
-- 睡眠ログ移行
INSERT INTO raw.fitbit__sleep (source_id, data, synced_at, api_version)
SELECT
    log_id::text as source_id,
    jsonb_build_object(
        'log_id', log_id::text,
        'date', date,
        'start_time', to_char(start_time AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
        'end_time', to_char(end_time AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
        'duration_ms', duration_ms,
        'efficiency', efficiency,
        'is_main_sleep', is_main_sleep,
        'minutes_asleep', minutes_asleep,
        'minutes_awake', minutes_awake,
        'time_in_bed', time_in_bed,
        'sleep_type', sleep_type,
        'levels', levels,
        '_start_time_utc', to_char(start_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        '_end_time_utc', to_char(end_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) as data,
    synced_at,
    'v1.2' as api_version
FROM raw.fitbit_sleep;

-- 日次活動サマリー移行
INSERT INTO raw.fitbit__activity_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'steps', steps,
        'distance_km', distance_km,
        'floors', floors,
        'calories_total', calories_total,
        'calories_bmr', calories_bmr,
        'calories_activity', calories_activity,
        'sedentary_minutes', sedentary_minutes,
        'lightly_active_minutes', lightly_active_minutes,
        'fairly_active_minutes', fairly_active_minutes,
        'very_active_minutes', very_active_minutes,
        'active_zone_minutes', active_zone_minutes,
        'intraday', intraday
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_activity_daily;

-- 日次心拍数移行
INSERT INTO raw.fitbit__heart_rate_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'resting_heart_rate', resting_heart_rate,
        'heart_rate_zones', heart_rate_zones,
        'intraday', intraday
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_heart_rate_daily;

-- HRV移行
INSERT INTO raw.fitbit__hrv_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'daily_rmssd', daily_rmssd,
        'deep_rmssd', deep_rmssd,
        'intraday', intraday
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_hrv_daily;

-- SpO2移行
INSERT INTO raw.fitbit__spo2_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'avg_spo2', avg_spo2,
        'min_spo2', min_spo2,
        'max_spo2', max_spo2,
        'intraday', intraday
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_spo2_daily;

-- 呼吸数移行
INSERT INTO raw.fitbit__breathing_rate_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'breathing_rate', breathing_rate,
        'intraday', intraday
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_breathing_rate_daily;

-- 心肺機能スコア移行
INSERT INTO raw.fitbit__cardio_score_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'vo2_max', vo2_max,
        'vo2_max_range_low', vo2_max_range_low,
        'vo2_max_range_high', vo2_max_range_high
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_cardio_score_daily;

-- 皮膚温度移行
INSERT INTO raw.fitbit__temperature_skin_daily (source_id, data, synced_at, api_version)
SELECT
    date::text as source_id,
    jsonb_build_object(
        'date', date,
        'nightly_relative', nightly_relative,
        'log_type', log_type
    ) as data,
    synced_at,
    'v1' as api_version
FROM raw.fitbit_temperature_skin_daily;
```

### Phase 3: データ検証

```sql
-- レコード数の比較
SELECT 'fitbit_sleep' as table_name, count(*) FROM raw.fitbit_sleep
UNION ALL SELECT 'fitbit__sleep', count(*) FROM raw.fitbit__sleep;

SELECT 'fitbit_activity_daily' as table_name, count(*) FROM raw.fitbit_activity_daily
UNION ALL SELECT 'fitbit__activity_daily', count(*) FROM raw.fitbit__activity_daily;

-- 以下同様に全テーブルを検証
```

### Phase 4: 旧テーブル削除

```sql
-- 旧テーブル削除
DROP TABLE raw.fitbit_sleep;
DROP TABLE raw.fitbit_activity_daily;
DROP TABLE raw.fitbit_heart_rate_daily;
DROP TABLE raw.fitbit_hrv_daily;
DROP TABLE raw.fitbit_spo2_daily;
DROP TABLE raw.fitbit_breathing_rate_daily;
DROP TABLE raw.fitbit_cardio_score_daily;
DROP TABLE raw.fitbit_temperature_skin_daily;
```

## staging ビュー (参考)

```sql
-- 睡眠
CREATE VIEW staging.stg_fitbit__sleep AS
SELECT
    id,
    source_id,
    source_id as log_id,
    (data->>'date')::date as date,
    (data->>'_start_time_utc')::timestamptz as start_time,
    (data->>'_end_time_utc')::timestamptz as end_time,
    (data->>'duration_ms')::integer as duration_ms,
    (data->>'efficiency')::integer as efficiency,
    (data->>'is_main_sleep')::boolean as is_main_sleep,
    (data->>'minutes_asleep')::integer as minutes_asleep,
    (data->>'minutes_awake')::integer as minutes_awake,
    (data->>'time_in_bed')::integer as time_in_bed,
    data->>'sleep_type' as sleep_type,
    data->'levels' as levels,
    synced_at
FROM raw.fitbit__sleep;

-- 日次活動
CREATE VIEW staging.stg_fitbit__activity_daily AS
SELECT
    id,
    source_id,
    source_id::date as date,
    (data->>'steps')::integer as steps,
    (data->>'distance_km')::numeric as distance_km,
    (data->>'floors')::integer as floors,
    (data->>'calories_total')::integer as calories_total,
    (data->>'calories_bmr')::integer as calories_bmr,
    (data->>'calories_activity')::integer as calories_activity,
    (data->>'sedentary_minutes')::integer as sedentary_minutes,
    (data->>'lightly_active_minutes')::integer as lightly_active_minutes,
    (data->>'fairly_active_minutes')::integer as fairly_active_minutes,
    (data->>'very_active_minutes')::integer as very_active_minutes,
    data->'active_zone_minutes' as active_zone_minutes,
    synced_at
FROM raw.fitbit__activity_daily;
```

## ディレクトリ構成

```
packages/connector/src/services/fitbit/
├── index.ts                      # Public exports
├── api-client.ts                 # API 通信・OAuth
├── orchestrator.ts               # 同期オーケストレーター
├── sync-sleep.ts                 # 睡眠データ同期
├── sync-activity.ts              # 活動データ同期
├── sync-heart-rate.ts            # 心拍数データ同期
├── sync-hrv.ts                   # HRVデータ同期
├── sync-spo2.ts                  # SpO2データ同期
├── sync-breathing-rate.ts        # 呼吸数データ同期
├── sync-cardio-score.ts          # 心肺機能スコア同期
├── sync-temperature-skin.ts      # 皮膚温度データ同期
└── cli.ts                        # CLI エントリポイント
```

## 参考資料

- [Fitbit Web API Reference](https://dev.fitbit.com/build/reference/web-api/)
- [OAuth 2.0 Authorization](https://dev.fitbit.com/build/reference/web-api/authorization/)
- [Fitbit Developer Portal](https://dev.fitbit.com/)

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-01-02 | 初版作成 |
