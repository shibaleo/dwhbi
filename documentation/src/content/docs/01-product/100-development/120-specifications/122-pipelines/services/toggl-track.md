---
title: Toggl Track 仕様
description: Toggl Track 同期モジュールの仕様
---

# Toggl Track 仕様

| 項目 | 内容 |
|------|------|
| 対象モジュール | `pipelines/services/toggl_track/` |
| 認証方式 | Basic Auth (API Token) |
| API | Track API v9, Reports API v3 |

## モジュール構成

```
pipelines/services/toggl_track/
├── __init__.py
├── api_client.py              # API通信（認証、レート制限対応）
├── orchestrator.py            # オーケストレーター（sync_all）
├── sync_masters.py            # マスターデータ同期
├── sync_time_entries.py       # Track API v9（日次同期用）
└── sync_time_entries_report.py # Reports API v3（全件取得用）
```

## 概要

Toggl Track から2種類のAPIを使ってデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

| データ | API | 用途 |
|--------|-----|------|
| マスター（clients, projects, tags, users等） | Track API v9 | 常に最新を取得 |
| 時間エントリー（日次） | Track API v9 | 実行中エントリー対応 |
| 時間エントリー（履歴） | Reports API v3 | 全件取得、billable情報含む |

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | Basic Auth |
| 認証情報取得 | Supabase Vault（`credentials.services`） |
| ヘッダー | `Authorization: Basic {base64(api_token:api_token)}` |

### 必要な認証情報

```json
{
  "api_token": "your_toggl_api_token",
  "workspace_id": 1234567
}
```

`workspace_id` が未設定の場合は `/me` APIから自動取得。

## API仕様

### Track API v9 エンドポイント

| データ型 | エンドポイント | メソッド |
|---------|-------------|---------|
| Me | `/api/v9/me` | GET |
| Workspaces | `/api/v9/workspaces` | GET |
| Clients | `/api/v9/workspaces/{wid}/clients` | GET |
| Projects | `/api/v9/workspaces/{wid}/projects` | GET |
| Tags | `/api/v9/workspaces/{wid}/tags` | GET |
| Users | `/api/v9/workspaces/{wid}/users` | GET |
| Groups | `/api/v9/workspaces/{wid}/groups` | GET |
| Time Entries | `/api/v9/me/time_entries` | GET |

### Reports API v3 エンドポイント

| データ型 | エンドポイント | メソッド |
|---------|-------------|---------|
| Detailed Report | `/reports/api/v3/workspace/{wid}/search/time_entries` | POST |

### レート制限（2025年9月5日以降）

Toggl APIには2種類の制限がある：

#### 1. APIクォータ（時間あたりリクエスト数）

**Workspace/Organization API**（ワークスペース固有のデータ取得）:

| プラン | 制限 |
|--------|------|
| Free | 30リクエスト/時間/ユーザー/組織 |
| Starter | 240リクエスト/時間/ユーザー/組織 |
| Premium | 600リクエスト/時間/ユーザー/組織 |
| Enterprise | カスタム |

**User-Specific API**（`/api/v9/me`等、個人データ取得）:
- 全プラン共通: 30リクエスト/時間/ユーザー

クォータ超過時は **HTTP 402** を返す。60分スライディングウィンドウでリセット。

#### 2. レートリミット（Leaky Bucket）

サーバー保護のための一般的な制限：

| 項目 | 内容 |
|------|------|
| 推奨レート | 1リクエスト/秒 |
| 適用単位 | APIトークン × IPアドレス |
| 超過時 | HTTP 429 (Too Many Requests) |
| 対処法 | 数分待機してリトライ |

#### エラーコードまとめ

| コード | 意味 | 対処法 |
|--------|------|--------|
| 402 | クォータ超過 | 60分待機、またはプランアップグレード |
| 429 | レートリミット超過 | 数秒〜数分待機してリトライ |

## データベーススキーマ

raw層テーブル（JSONB形式）:

### raw.toggl_track__time_entries

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| source_id | TEXT | NO | PK (エントリーID) |
| data | JSONB | NO | APIレスポンス全体 |
| api_version | TEXT | NO | "v9" |
| synced_at | TIMESTAMPTZ | NO | 同期日時 |

### raw.toggl_track__time_entries_report

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| source_id | TEXT | NO | PK (エントリーID) |
| data | JSONB | NO | APIレスポンス全体 |
| api_version | TEXT | NO | "v3" |
| synced_at | TIMESTAMPTZ | NO | 同期日時 |

### raw.toggl_track__projects, __clients, __tags 等

同様のJSONB形式で保存。

## Staging層

`stg_toggl_track__time_entries` ビューで2つのソースを統合:

- Reports API v3（優先）: 履歴データ、billable情報あり
- Track API v9: 実行中エントリー（`is_running = true`）

重複時はReports APIを優先（`ROW_NUMBER()`で重複排除）。

## 処理フロー

### 日次同期（sync_all）

```
1. sync_all(days=3) 呼び出し
2. マスターデータ同期（sync_masters）
   - clients, projects, tags, users, groups, workspaces, me
3. 時間エントリー同期（sync_time_entries）
   - Track API v9で指定日数分を取得
4. raw層にJSONB形式で保存
```

### 履歴同期（sync_time_entries_report）

```
1. sync_time_entries_report(days=365) 呼び出し
2. 1年以上の場合は自動分割
3. Reports API v3でページネーション取得
4. グループ化レスポンスをフラット化
5. raw層にJSONB形式で保存
```

## 使用方法

```python
# 日次同期（マスター + Track API v9）
from pipelines.services.toggl_track.orchestrator import sync_all
result = await sync_all(days=3)

# 履歴同期（Reports API v3）
from pipelines.services.toggl_track.sync_time_entries_report import sync_time_entries_report
result = await sync_time_entries_report(days=365)
```

## GitHub Actions

| ワークフロー | 説明 | トリガー |
|-------------|------|---------|
| `sync-toggl.yml` | 日次同期 | 手動 |
| `sync-toggl-report.yml` | Reports API同期 | 手動 |
| `sync-daily.yml` | 全サービス同期 | 手動/スケジュール |

## 参考資料

- [Toggl Track API v9](https://developers.track.toggl.com/docs/)
- [Toggl Reports API v3](https://developers.track.toggl.com/docs/reports_api/)
- [API制限について](https://support.toggl.com/en/articles/11484112-api-webhook-limits)
