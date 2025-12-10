---
title: Google Calendar コネクタ設計
description: Google Calendar API との連携設計
---

# Google Calendar コネクタ設計

## 概要

Google Calendar API からデータを取得し、PostgreSQL raw 層に保存するコネクタ。

| 項目 | 値 |
|------|-----|
| パッケージ | `@repo/connector/google-calendar` |
| 認証方式 | OAuth 2.0 (Refresh Token) |
| API バージョン | Calendar API v3 |
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
│  │ getDbClient() → syncMasters() → syncEvents()            ││
│  │                → closeDbClient()                         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
┌─────────▼──────────┐          ┌────────▼─────────┐
│  sync-masters.ts   │          │  sync-events.ts  │
│  (マスタ同期)       │          │  (イベント同期)   │
└─────────┬──────────┘          └────────┬─────────┘
          │                               │
          └───────────────┬───────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    api-client.ts                             │
│                   (API通信・OAuth)                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ getAuthInfo() - トークン自動リフレッシュ                  ││
│  │ fetchEvents(), fetchColors(), fetchCalendarList()        ││
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
3. マスタ同期 (並列実行)
   - colors, calendar_list, calendars
4. イベント同期 (日付範囲指定、ページネーション対応)
5. DB接続クローズ (closeDbClient)
```

### 認証フロー

```
1. getAuthInfo() 呼び出し
2. キャッシュ確認 (有効期限5分以上なら返却)
3. Vault から認証情報取得
4. トークン有効期限チェック
   - 有効期限切れまたは5分以内 → リフレッシュ
5. リフレッシュ実行
   - Google OAuth endpoint に refresh_token 送信
   - 新しい access_token 取得
   - Vault 更新 (access_token, _expires_at)
6. calendar_id 取得 (未設定なら CalendarList から primary を検出)
7. キャッシュに保存
```

## API エンドポイント

### Calendar API v3

| エンドポイント | メソッド | 用途 |
|--------------|---------|------|
| `/colors` | GET | カラーパレット |
| `/users/me/calendarList` | GET | カレンダー一覧 |
| `/calendars/{id}` | GET | カレンダー詳細 |
| `/calendars/{id}/events` | GET | イベント一覧 |

### OAuth

| エンドポイント | 用途 |
|--------------|------|
| `https://oauth2.googleapis.com/token` | トークンリフレッシュ |

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

| テーブル名 | source_id | 更新頻度 |
|-----------|-----------|---------|
| `raw.google_calendar__colors` | `event` / `calendar` | 毎回 |
| `raw.google_calendar__calendar_list` | calendar_id | 毎回 |
| `raw.google_calendar__calendars` | calendar_id | 毎回 |
| `raw.google_calendar__events` | `{calendar_id}:{event_id}` | 日次 |

### イベント source_id 形式

複数カレンダー対応のため、source_id は `{calendar_id}:{event_id}` 形式で保存。

```typescript
const sourceId = `${calendarId}:${eventId}`;
// 例: "user@gmail.com:abc123xyz"
```

## Vault 認証情報

```json
{
  "client_id": "xxxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxxxx",
  "refresh_token": "1//xxxxx",
  "access_token": "ya29.xxxxx",
  "calendar_id": "user@gmail.com",
  "_auth_type": "oauth2",
  "_expires_at": "2025-01-01T00:00:00.000Z"
}
```

| フィールド | 必須 | 説明 |
|-----------|-----|------|
| `client_id` | ○ | OAuth クライアント ID |
| `client_secret` | ○ | OAuth クライアントシークレット |
| `refresh_token` | ○ | リフレッシュトークン |
| `access_token` | ○ | アクセストークン (自動更新) |
| `calendar_id` | △ | カレンダー ID (未設定時は primary を自動検出) |
| `_auth_type` | ○ | `"oauth2"` 固定 |
| `_expires_at` | △ | トークン有効期限 (自動更新) |

## トークンリフレッシュ

### 自動リフレッシュ条件

- `_expires_at` が未設定
- 現在時刻から有効期限まで5分以内
- `forceRefresh = true` で呼び出し

### リフレッシュ処理

```typescript
const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: "refresh_token",
  }),
});

// Vault 更新
await updateCredentials("google_calendar", {
  access_token: newToken.access_token,
  scope: newToken.scope,
}, expiresAt);
```

## イベント取得のページネーション

```typescript
const MAX_RESULTS_PER_PAGE = 2500;

while (true) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(MAX_RESULTS_PER_PAGE),
    singleEvents: "true",
    orderBy: "startTime",
  });
  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const data = await fetch(url);
  allEvents.push(...data.items);

  if (!data.nextPageToken) break;
  pageToken = data.nextPageToken;
}
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
[OK] Google Calendar sync completed:
  Events: 12
  Masters: {"colors":2,"calendarList":3,"calendars":3}
  Elapsed: 1.50s
```

**info レベル** (デフォルト)
```
[2025-12-10 01:15:00] INFO  [gcal-orchestrator] Starting Google Calendar full sync (3 days)
[2025-12-10 01:15:00] INFO  [raw-client] Database connection established
[2025-12-10 01:15:00] INFO  [gcal-orchestrator] Step 1: Syncing masters...
[2025-12-10 01:15:01] INFO  [raw-client] Upserted 2 records to raw.google_calendar__colors
[2025-12-10 01:15:01] INFO  [raw-client] Upserted 3 records to raw.google_calendar__calendar_list
...
[2025-12-10 01:15:02] INFO  [gcal-orchestrator] Google Calendar full sync completed in 2.10s
[2025-12-10 01:15:02] INFO  [raw-client] Database connection closed
```

**debug レベル** (`--log-level debug`)
```
[2025-12-10 01:15:00] DEBUG [gcal-api] Loading credentials from vault...
[2025-12-10 01:15:00] DEBUG [vault] Connecting to vault for service: google_calendar
[2025-12-10 01:15:00] DEBUG [vault] Credentials loaded for google_calendar (expires: 2025-12-10T02:15:00.000Z)
[2025-12-10 01:15:00] DEBUG [gcal-api] Access token valid, using cached
[2025-12-10 01:15:00] DEBUG [gcal-api] Auth initialized: calendar_id=user@gmail.com
[2025-12-10 01:15:00] INFO  [gcal-orchestrator] Starting Google Calendar full sync (3 days)
[2025-12-10 01:15:00] DEBUG [raw-client] Creating new database connection...
[2025-12-10 01:15:00] INFO  [raw-client] Database connection established
[2025-12-10 01:15:00] DEBUG [gcal-api] Using cached auth info
[2025-12-10 01:15:00] DEBUG [gcal-api] GET /colors
[2025-12-10 01:15:01] DEBUG [gcal-api] Response: colors fetched
...
```

## 使用例

### CLI

```bash
# デフォルト 3日分（info レベル）
npm run sync:gcal

# 7日分
npm run sync:gcal -- --days 7

# 本番環境向け（ログ最小限）
npm run sync:gcal -- --log-level warn
```

### ライブラリ

```typescript
import { syncAll } from "@repo/connector/google-calendar";

const result = await syncAll(7);
console.log(result.eventsCount);
console.log(result.mastersCounts);
```

## OAuth 初回設定

1. Google Cloud Console でプロジェクト作成
2. Calendar API を有効化
3. OAuth 同意画面を設定
4. OAuth クライアント ID を作成 (デスクトップアプリ)
5. OAuth Playground 等で refresh_token を取得
6. Vault に認証情報を登録

```sql
SELECT vault.create_secret(
  '{
    "client_id": "xxxxx.apps.googleusercontent.com",
    "client_secret": "GOCSPX-xxxxx",
    "refresh_token": "1//xxxxx",
    "access_token": "ya29.xxxxx",
    "_auth_type": "oauth2"
  }',
  'google_calendar',
  'Google Calendar credentials'
);
```

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-12-10 | 初版作成 |
