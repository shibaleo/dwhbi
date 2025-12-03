---
title: Toggl Track 仕様
description: Toggl Track 同期モジュールの仕様
---

# Toggl Track 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/toggl.py` |
| 認証方式 | Basic Auth (API Token) |
| API | Toggl Track API v9 |

## 概要

Toggl Track API v9 からデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- クライアント
- プロジェクト
- タグ
- 時間エントリー

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | Basic Auth |
| 認証情報 | API Token |
| ヘッダー | `Authorization: Basic {base64(api_token:api_token)}` |

### 必要な認証情報

```json
{
  "api_token": "your_toggl_api_token"
}
```

`workspace_id` は API（`/me`）から自動取得。

## API仕様

### エンドポイント

| データ型 | エンドポイント | メソッド |
|---------|-------------|---------|
| Clients | `/api/v9/workspaces/{wid}/clients` | GET |
| Projects | `/api/v9/workspaces/{wid}/projects` | GET |
| Tags | `/api/v9/workspaces/{wid}/tags` | GET |
| Entries | `/api/v9/me/time_entries` | GET |

### リクエストパラメータ（Time Entries）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| start_date | 開始日（ISO8601） | "2025-11-28T00:00:00Z" |
| end_date | 終了日（ISO8601） | "2025-12-01T23:59:59Z" |

### レート制限

- 1リクエスト/秒（公式非公開）
- 4リクエスト程度なら問題なし

## データベーススキーマ

### raw.toggl_clients

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| name | TEXT | NO | クライアント名 |
| is_archived | BOOLEAN | YES | アーカイブ済みか |
| created_at | TIMESTAMPTZ | NO | 作成日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.toggl_projects

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| client_id | BIGINT | YES | FK → toggl_clients.id |
| name | TEXT | NO | プロジェクト名 |
| color | TEXT | YES | カラーコード |
| is_private | BOOLEAN | YES | プライベートか |
| is_active | BOOLEAN | YES | アクティブか |
| is_billable | BOOLEAN | YES | 課金対象か |
| created_at | TIMESTAMPTZ | NO | 作成日時 |
| archived_at | TIMESTAMPTZ | YES | アーカイブ日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.toggl_tags

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| name | TEXT | NO | タグ名 |
| created_at | TIMESTAMPTZ | NO | 作成日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.toggl_entries

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| project_id | BIGINT | YES | FK → toggl_projects.id |
| task_id | BIGINT | YES | タスクID |
| user_id | BIGINT | YES | ユーザーID |
| description | TEXT | YES | 説明 |
| start | TIMESTAMPTZ | NO | 開始時刻 |
| end | TIMESTAMPTZ | YES | 終了時刻（実行中はNULL） |
| duration_ms | BIGINT | YES | 期間ミリ秒（実行中はNULL） |
| is_billable | BOOLEAN | YES | 課金対象か |
| billable_amount | NUMERIC | YES | 課金額（Reports APIのみ） |
| currency | TEXT | YES | 通貨（Reports APIのみ） |
| tags | TEXT[] | YES | タグ配列 |
| updated_at | TIMESTAMPTZ | YES | 更新日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## 処理フロー

```
1. sync_toggl(days=3) 呼び出し
2. 日付範囲計算（today - days + 1 〜 today）
3. 認証情報取得（キャッシュ優先）
4. 並列API取得（clients, projects, tags, entries）
5. 型変換（API型 → DB型）
6. DB保存（メタデータ → エントリーの順序）
```

### 保存順序

外部キー制約により、メタデータを先に保存：
1. clients
2. projects
3. tags
4. entries

## 制限事項

| 制限 | 説明 |
|------|------|
| Reports API 未対応 | billable_amount, currency は取得不可 |
| 差分同期未実装 | 毎回全件取得（指定日数分） |
| 単一ワークスペース | 複数ワークスペース非対応 |

## 参考資料

- [Toggl Track API v9](https://developers.track.toggl.com/docs/)
- [Toggl Reports API v3](https://developers.track.toggl.com/docs/reports_api/)
