---
title: Tanita Health Planet コネクタ設計
description: Tanita Health Planet API との連携設計
---

# Tanita Health Planet コネクタ設計

## 概要

Tanita Health Planet API からデータを取得し、PostgreSQL raw 層に保存するコネクタ。

| 項目 | 値 |
|------|-----|
| パッケージ | `@repo/connector/tanita-health-planet` |
| 認証方式 | OAuth 2.0 (Refresh Token) |
| API バージョン | Health Planet API v1 |
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
│  │ getDbClient() → syncBodyComposition()                   ││
│  │              → syncBloodPressure()                      ││
│  │              → closeDbClient()                          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
┌─────────▼────────────────┐    ┌────────▼─────────────────┐
│  sync-body-composition.ts │    │  sync-blood-pressure.ts  │
│  (体組成同期)             │    │  (血圧同期)               │
└─────────┬────────────────┘    └────────┬─────────────────┘
          │                               │
          └───────────────┬───────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    api-client.ts                             │
│                   (API通信・OAuth)                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ getAuthInfo() - トークン自動リフレッシュ                  ││
│  │ fetchInnerScan(), fetchSphygmomanometer()               ││
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
4. データ同期 (並列実行)
   - body_composition (体組成: 体重、体脂肪率)
   - blood_pressure (血圧: 最高血圧、最低血圧、脈拍)
5. DB接続クローズ (closeDbClient)
```

### 認証フロー

```
1. getAuthInfo() 呼び出し
2. キャッシュ確認 (有効期限30分以上なら返却)
3. Vault から認証情報取得
4. トークン有効期限チェック
   - 有効期限切れまたは30分以内 → リフレッシュ
5. リフレッシュ実行
   - Health Planet OAuth endpoint に refresh_token 送信
   - 新しい access_token 取得 (有効期限: 3時間)
   - Vault 更新 (access_token, _expires_at)
6. キャッシュに保存
```

## API エンドポイント

### Health Planet API

| エンドポイント | メソッド | 用途 |
|--------------|---------|------|
| `/status/innerscan.json` | GET | 体組成データ (体重、体脂肪率) |
| `/status/sphygmomanometer.json` | GET | 血圧データ (最高血圧、最低血圧、脈拍) |

### OAuth

| エンドポイント | 用途 |
|--------------|------|
| `https://www.healthplanet.jp/oauth/token` | トークンリフレッシュ |

### リクエストパラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `access_token` | アクセストークン | - |
| `date` | 取得方法 | `"1"` (期間指定) |
| `from` | 開始日時 | `"20250101000000"` (14桁) |
| `to` | 終了日時 | `"20250131235959"` (14桁) |
| `tag` | 測定項目タグ | `"6021,6022"` |

### 測定タグ

**体組成 (innerscan)**:

| タグ | 項目 | 単位 |
|------|------|------|
| 6021 | 体重 | kg |
| 6022 | 体脂肪率 | % |

**血圧 (sphygmomanometer)**:

| タグ | 項目 | 単位 |
|------|------|------|
| 622E | 最高血圧 | mmHg |
| 622F | 最低血圧 | mmHg |
| 6230 | 脈拍 | bpm |

## レートリミット対応

```typescript
// 429 応答時の処理
if (response.status === 429) {
  const waitSeconds = handleRateLimit(response);
  await sleep(waitSeconds * 1000);
  // リトライ
}

// 401 応答時はトークンリフレッシュ
if (response.status === 401) {
  await getAuthInfo(true);  // forceRefresh
  // リトライ
}
```

## raw テーブル

既存テーブルを削除し、Google Calendar と同じパターンに統一する。

### 変更前 (既存テーブル - 削除対象)

- `raw.tanita_body_composition` - カラム定義型 (measured_at, weight, body_fat_percent, model)
- `raw.tanita_blood_pressure` - カラム定義型 (measured_at, systolic, diastolic, pulse, model)
- `raw.tanita_steps` - カラム定義型 (measured_at, steps, model)

### 変更後 (新テーブル)

| テーブル名 | source_id | 更新頻度 |
|-----------|-----------|---------|
| `raw.tanita_health_planet__body_composition` | `{measured_at_iso}` | 日次 |
| `raw.tanita_health_planet__blood_pressure` | `{measured_at_iso}` | 日次 |

### 新テーブル定義

```sql
-- 体組成データ
CREATE TABLE raw.tanita_health_planet__body_composition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- ISO8601形式の測定日時
    data JSONB NOT NULL,              -- API レスポンス全体
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_tanita_hp_body_composition_synced_at
    ON raw.tanita_health_planet__body_composition(synced_at);

-- 血圧データ
CREATE TABLE raw.tanita_health_planet__blood_pressure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,   -- ISO8601形式の測定日時
    data JSONB NOT NULL,              -- API レスポンス全体
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_tanita_hp_blood_pressure_synced_at
    ON raw.tanita_health_planet__blood_pressure(synced_at);
```

### source_id 形式

測定日時を ISO8601 形式で保存。同一日時の測定は 1 レコードとして扱う。

```typescript
// API レスポンスの日時 (12桁) を UTC ISO8601 に変換
const sourceId = convertToIso8601Utc(measurement.date);
// 例: "2025-01-15T00:30:00.000Z"
```

### data JSONB 構造

**体組成 (body_composition)**:

```json
{
  "date": "202501150930",
  "keydata": "6021",
  "model": "00000000",
  "tag": "6021",
  "weight": "65.5",
  "body_fat_percent": "18.2",
  "_measured_at_jst": "2025-01-15T09:30:00+09:00",
  "_raw_response": {
    "birth_date": "19900101",
    "height": "170",
    "sex": "male",
    "data": [...]
  }
}
```

**血圧 (blood_pressure)**:

```json
{
  "date": "202501150700",
  "keydata": "622E",
  "model": "00000000",
  "tag": "622E",
  "systolic": "120",
  "diastolic": "80",
  "pulse": "72",
  "_measured_at_jst": "2025-01-15T07:00:00+09:00",
  "_raw_response": {
    "data": [...]
  }
}
```

## 日時変換

### リクエスト用 (14桁形式)

```typescript
function formatTanitaRequestDate(date: Date): string {
  // UTC から JST に変換して 14 桁形式に
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
}
// 例: "20250115000000"
```

### レスポンス用 (12桁 → ISO8601)

```typescript
function parseTanitaResponseDate(dateStr: string): string {
  // 12桁 JST を UTC ISO8601 に変換
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const hour = dateStr.slice(8, 10);
  const minute = dateStr.slice(10, 12);

  const jstDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`);
  return jstDate.toISOString();
}
// 例: "202501150930" → "2025-01-15T00:30:00.000Z"
```

## データ取得の期間制限

Health Planet API は 1 リクエストあたり最大 3 ヶ月分のデータしか取得できない。

```typescript
const MAX_DAYS_PER_REQUEST = 90;

async function fetchWithChunks(
  startDate: Date,
  endDate: Date,
  fetchFn: (from: Date, to: Date) => Promise<Measurement[]>
): Promise<Measurement[]> {
  const results: Measurement[] = [];
  let currentStart = startDate;

  while (currentStart < endDate) {
    const chunkEnd = new Date(
      Math.min(
        currentStart.getTime() + MAX_DAYS_PER_REQUEST * 24 * 60 * 60 * 1000,
        endDate.getTime()
      )
    );

    const data = await fetchFn(currentStart, chunkEnd);
    results.push(...data);

    currentStart = chunkEnd;
  }

  return results;
}
```

## Vault 認証情報

```json
{
  "client_id": "xxxxx",
  "client_secret": "xxxxx",
  "refresh_token": "xxxxx",
  "access_token": "xxxxx",
  "scope": "innerscan,sphygmomanometer",
  "_auth_type": "oauth2",
  "_expires_at": "2025-01-01T03:00:00.000Z"
}
```

| フィールド | 必須 | 説明 |
|-----------|-----|------|
| `client_id` | ○ | OAuth クライアント ID |
| `client_secret` | ○ | OAuth クライアントシークレット |
| `refresh_token` | ○ | リフレッシュトークン |
| `access_token` | ○ | アクセストークン (自動更新) |
| `scope` | ○ | API スコープ (`innerscan,sphygmomanometer`) |
| `_auth_type` | ○ | `"oauth2"` 固定 |
| `_expires_at` | △ | トークン有効期限 (自動更新) |

## トークンリフレッシュ

### 自動リフレッシュ条件

- `_expires_at` が未設定
- 現在時刻から有効期限まで30分以内
- `forceRefresh = true` で呼び出し

### リフレッシュ処理

```typescript
const DEFAULT_THRESHOLD_MINUTES = 30;

const response = await fetch("https://www.healthplanet.jp/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: "refresh_token",
  }),
});

// 新しいトークンの有効期限は 3 時間
const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);

// Vault 更新
await updateCredentials("tanita_health_planet", {
  access_token: newToken.access_token,
}, expiresAt);
```

## エラーハンドリング

| エラー | 対応 |
|--------|------|
| 401 Unauthorized | トークンリフレッシュ → リトライ |
| 429 Too Many Requests | Retry-After 待機 → リトライ |
| 400 Token refresh error | リフレッシュトークン失効 → エラー終了 (再認証必要) |
| 5xx Server Error | 1秒待機 → 1回リトライ → エラー終了 |

## ログレベル

`--log-level` フラグでログ出力量を制御。デフォルトは `info`。

| レベル | 用途 | 出力例 |
|--------|------|--------|
| `warn` | 本番環境 | 警告・エラーのみ |
| `info` | 開発・確認 | 進捗ログ（デフォルト） |
| `debug` | デバッグ | API呼び出し、キャッシュ状態等 |

### ログ出力例

**warn レベル** (`--log-level warn`)
```
[OK] Tanita Health Planet sync completed:
  Body Composition: 5
  Blood Pressure: 7
  Elapsed: 2.30s
```

**info レベル** (デフォルト)
```
[2025-12-10 01:15:00] INFO  [tanita-orchestrator] Starting Tanita Health Planet sync (30 days)
[2025-12-10 01:15:00] INFO  [raw-client] Database connection established
[2025-12-10 01:15:00] INFO  [tanita-orchestrator] Step 1: Syncing body composition...
[2025-12-10 01:15:01] INFO  [raw-client] Upserted 5 records to raw.tanita_health_planet__body_composition
[2025-12-10 01:15:01] INFO  [tanita-orchestrator] Step 2: Syncing blood pressure...
[2025-12-10 01:15:02] INFO  [raw-client] Upserted 7 records to raw.tanita_health_planet__blood_pressure
[2025-12-10 01:15:02] INFO  [tanita-orchestrator] Tanita Health Planet sync completed in 2.30s
[2025-12-10 01:15:02] INFO  [raw-client] Database connection closed
```

**debug レベル** (`--log-level debug`)
```
[2025-12-10 01:15:00] DEBUG [tanita-api] Loading credentials from vault...
[2025-12-10 01:15:00] DEBUG [vault] Connecting to vault for service: tanita_health_planet
[2025-12-10 01:15:00] DEBUG [vault] Credentials loaded for tanita_health_planet (expires: 2025-12-10T04:15:00.000Z)
[2025-12-10 01:15:00] DEBUG [tanita-api] Access token valid, using cached
[2025-12-10 01:15:00] INFO  [tanita-orchestrator] Starting Tanita Health Planet sync (30 days)
[2025-12-10 01:15:00] DEBUG [raw-client] Creating new database connection...
[2025-12-10 01:15:00] INFO  [raw-client] Database connection established
[2025-12-10 01:15:00] DEBUG [tanita-api] GET /status/innerscan.json from=20251110 to=20251210
[2025-12-10 01:15:01] DEBUG [tanita-api] Response: 5 body composition records
...
```

## 使用例

### CLI

```bash
# デフォルト 30日分（info レベル）
npm run sync:tanita

# 90日分
npm run sync:tanita -- --days 90

# 本番環境向け（ログ最小限）
npm run sync:tanita -- --log-level warn
```

### ライブラリ

```typescript
import { syncAll } from "@repo/connector/tanita-health-planet";

const result = await syncAll({ days: 30 });
console.log(result.bodyCompositionCount);
console.log(result.bloodPressureCount);
```

## マイグレーション計画

### Phase 1: 新テーブル作成

```sql
-- 新テーブル作成
CREATE TABLE raw.tanita_health_planet__body_composition (...);
CREATE TABLE raw.tanita_health_planet__blood_pressure (...);
```

### Phase 2: データ移行

```sql
-- 既存データを新テーブルに移行
INSERT INTO raw.tanita_health_planet__body_composition (source_id, data, synced_at)
SELECT
    to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_id,
    jsonb_build_object(
        'weight', weight,
        'body_fat_percent', body_fat_percent,
        'model', model,
        '_measured_at_jst', to_char(measured_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"')
    ) as data,
    synced_at
FROM raw.tanita_body_composition;

INSERT INTO raw.tanita_health_planet__blood_pressure (source_id, data, synced_at)
SELECT
    to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_id,
    jsonb_build_object(
        'systolic', systolic,
        'diastolic', diastolic,
        'pulse', pulse,
        'model', model,
        '_measured_at_jst', to_char(measured_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"')
    ) as data,
    synced_at
FROM raw.tanita_blood_pressure;
```

### Phase 3: 旧テーブル削除

```sql
DROP TABLE raw.tanita_body_composition;
DROP TABLE raw.tanita_blood_pressure;
DROP TABLE raw.tanita_steps;  -- 使用されていないため削除
```

## staging テーブル (参考)

raw テーブルのデータを変換・抽出する staging テーブルを別途定義。

```sql
CREATE VIEW stg_tanita_health_planet__body_composition AS
SELECT
    id,
    source_id,
    source_id::timestamptz AS measured_at,
    (data->>'weight')::numeric AS weight,
    (data->>'body_fat_percent')::numeric AS body_fat_percent,
    data->>'model' AS model,
    synced_at
FROM raw.tanita_health_planet__body_composition;

CREATE VIEW stg_tanita_health_planet__blood_pressure AS
SELECT
    id,
    source_id,
    source_id::timestamptz AS measured_at,
    (data->>'systolic')::integer AS systolic,
    (data->>'diastolic')::integer AS diastolic,
    (data->>'pulse')::integer AS pulse,
    data->>'model' AS model,
    synced_at
FROM raw.tanita_health_planet__blood_pressure;
```

## OAuth 初回設定

1. Health Planet アプリケーション登録ページでアプリを作成
2. リダイレクト URI を設定
3. OAuth 認証フローで refresh_token を取得
4. Vault に認証情報を登録

```sql
SELECT vault.create_secret(
  '{
    "client_id": "xxxxx",
    "client_secret": "xxxxx",
    "refresh_token": "xxxxx",
    "access_token": "xxxxx",
    "scope": "innerscan,sphygmomanometer",
    "_auth_type": "oauth2"
  }',
  'tanita_health_planet',
  'Tanita Health Planet credentials'
);
```

## ディレクトリ構成

```
packages/connector/src/services/tanita-health-planet/
├── index.ts                      # Public exports
├── api-client.ts                 # API 通信・OAuth
├── orchestrator.ts               # 同期オーケストレーター
├── sync-body-composition.ts      # 体組成データ同期
├── sync-blood-pressure.ts        # 血圧データ同期
└── cli.ts                        # CLI エントリポイント
```

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-01-02 | 初版作成 |
