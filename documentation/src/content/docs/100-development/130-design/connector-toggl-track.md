---
title: Toggl Track コネクタ設計
description: Toggl Track API との連携設計
---

# Toggl Track コネクタ設計

## 概要

Toggl Track API からデータを取得し、PostgreSQL raw 層に保存するコネクタ。

| 項目 | 値 |
|------|-----|
| パッケージ | `@repo/connector/toggl-track` |
| 認証方式 | API Token (Basic Auth) |
| API バージョン | Track API v9, Reports API v3 |
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
│  │ getDbClient() → syncMasters() → syncTimeEntries()       ││
│  │                → closeDbClient()                         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
┌─────────▼──────────┐          ┌────────▼─────────┐
│  sync-masters.ts   │          │sync-time-entries │
│  (マスタ同期)       │          │  (時間記録同期)   │
└─────────┬──────────┘          └────────┬─────────┘
          │                               │
          └───────────────┬───────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    api-client.ts                             │
│                   (API通信・認証)                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ getAuthInfo() - 認証情報キャッシュ                       ││
│  │ fetchProjects(), fetchTimeEntries(), etc.                ││
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
   - projects, clients, tags, me, workspaces, users, groups
4. 時間記録同期 (日付範囲指定)
5. DB接続クローズ (closeDbClient)
```

### 認証フロー

```
1. getAuthInfo() 呼び出し
2. キャッシュ確認 (あれば返却)
3. Vault から認証情報取得
4. Basic Auth ヘッダー生成 (api_token:api_token base64)
5. workspace_id 取得 (未設定なら /me から)
6. キャッシュに保存
```

## API エンドポイント

### Track API v9

| エンドポイント | メソッド | 用途 |
|--------------|---------|------|
| `/me` | GET | ユーザー情報 |
| `/me/time_entries` | GET | 時間記録 (日付範囲) |
| `/workspaces` | GET | ワークスペース一覧 |
| `/workspaces/{id}/projects` | GET | プロジェクト一覧 |
| `/workspaces/{id}/clients` | GET | クライアント一覧 |
| `/workspaces/{id}/tags` | GET | タグ一覧 |
| `/workspaces/{id}/users` | GET | ユーザー一覧 |
| `/workspaces/{id}/groups` | GET | グループ一覧 |

### Reports API v3

| エンドポイント | メソッド | 用途 |
|--------------|---------|------|
| `/workspace/{id}/search/time_entries` | POST | 詳細レポート |

## レートリミット対応

```typescript
// 429 応答時の処理
if (response.status === 429) {
  const waitSeconds = handleRateLimit(response);
  await sleep(waitSeconds * 1000);
  // リトライ
}

// Retry-After ヘッダー優先、なければ X-RateLimit-Reset
function handleRateLimit(response): number {
  const retryAfter = response.headers.get("Retry-After");
  const resetTime = response.headers.get("X-RateLimit-Reset");
  // パースして待機秒数を返却
}
```

## raw テーブル

| テーブル名 | source_id | 更新頻度 |
|-----------|-----------|---------|
| `raw.toggl_track__me` | user_id | 毎回 |
| `raw.toggl_track__workspaces` | workspace_id | 毎回 |
| `raw.toggl_track__projects` | project_id | 毎回 |
| `raw.toggl_track__clients` | client_id | 毎回 |
| `raw.toggl_track__tags` | tag_id | 毎回 |
| `raw.toggl_track__users` | user_id | 毎回 |
| `raw.toggl_track__groups` | group_id | 毎回 |
| `raw.toggl_track__time_entries` | entry_id | 日次 |

## Vault 認証情報

```json
{
  "api_token": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "workspace_id": 12345678,
  "_auth_type": "api_key"
}
```

| フィールド | 必須 | 説明 |
|-----------|-----|------|
| `api_token` | ○ | API トークン (Profile > API Token) |
| `workspace_id` | △ | ワークスペース ID (未設定時は /me から取得) |
| `_auth_type` | ○ | `"api_key"` 固定 |

## エラーハンドリング

| エラー | 対応 |
|--------|------|
| 401 Unauthorized | API トークン無効 → エラー終了 |
| 429 Too Many Requests | Retry-After 待機 → リトライ |
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
[OK] Toggl Track sync completed:
  Time entries: 15
  Masters: {"projects":24,"clients":5,...}
  Elapsed: 1.02s
```

**info レベル** (デフォルト)
```
[2025-12-10 01:12:18] INFO  [toggl-orchestrator] Starting Toggl Track full sync (1 days)
[2025-12-10 01:12:18] INFO  [raw-client] Database connection established
[2025-12-10 01:12:18] INFO  [toggl-orchestrator] Step 1: Syncing masters...
[2025-12-10 01:12:18] INFO  [toggl-masters] Starting Toggl masters sync
[2025-12-10 01:12:19] INFO  [raw-client] Upserted 24 records to raw.toggl_track__projects
...
[2025-12-10 01:12:19] INFO  [toggl-orchestrator] Toggl Track full sync completed in 0.84s
[2025-12-10 01:12:19] INFO  [raw-client] Database connection closed
```

**debug レベル** (`--log-level debug`)
```
[2025-12-10 01:11:58] DEBUG [toggl-api] Loading credentials from vault...
[2025-12-10 01:11:58] DEBUG [vault] Connecting to vault for service: toggl_track
[2025-12-10 01:11:58] DEBUG [vault] Credentials loaded for toggl_track (expires: never)
[2025-12-10 01:11:58] DEBUG [toggl-api] Basic auth header generated
[2025-12-10 01:11:58] DEBUG [toggl-api] Auth initialized: workspace_id=7786272
[2025-12-10 01:11:58] INFO  [toggl-orchestrator] Starting Toggl Track full sync (1 days)
[2025-12-10 01:11:58] DEBUG [raw-client] Creating new database connection...
[2025-12-10 01:11:58] INFO  [raw-client] Database connection established
[2025-12-10 01:11:58] DEBUG [toggl-api] Using cached auth info
[2025-12-10 01:11:58] DEBUG [toggl-api] GET /workspaces/7786272/projects
[2025-12-10 01:11:58] DEBUG [toggl-api] Response: 24 projects
...
```

## 使用例

### CLI

```bash
# デフォルト 3日分（info レベル）
npm run sync:toggl

# 7日分
npm run sync:toggl -- --days 7

# 本番環境向け（ログ最小限）
npm run sync:toggl -- --log-level warn
```

### ライブラリ

```typescript
import { syncAll } from "@repo/connector/toggl-track";

const result = await syncAll(7);
console.log(result.timeEntriesCount);
console.log(result.mastersCounts);
```

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-12-10 | 初版作成 |
