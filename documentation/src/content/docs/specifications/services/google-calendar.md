---
title: Google Calendar 仕様
description: Google Calendar 同期モジュールの仕様
---

# Google Calendar 仕様

| 項目 | 内容 |
|------|------|
| 対象モジュール | `pipelines/services/google_calendar/` |
| 認証方式 | OAuth 2.0 |
| API | Google Calendar API v3 |

## モジュール構成

```
pipelines/services/google_calendar/
├── __init__.py
├── api_client.py              # API通信（認証、レート制限対応）
├── orchestrator.py            # オーケストレーター（sync_all）
├── sync_events.py             # イベント同期（日次同期用）
└── sync_masters.py            # マスターデータ同期（colors, calendars等）
```

## 概要

Google Calendar API v3 からイベントおよびマスターデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

| データ | API | 用途 |
|--------|-----|------|
| マスター（colors, calendar_list, calendars） | Calendar API v3 | 常に最新を取得 |
| イベント | Calendar API v3 | 指定日数分を取得 |

### 同期対象イベント

- 通常イベント（時刻指定あり）
- 終日イベント（時刻指定なし）
- 繰り返しイベント（展開済み）

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | OAuth 2.0 Authorization Code Flow |
| 認証情報取得 | Supabase Vault（`credentials.services`） |
| トークン有効期限 | 1時間 |
| リフレッシュ閾値 | 5分前 |

### 必要な認証情報

```json
{
  "client_id": "xxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxxx",
  "access_token": "ya29.xxxx",
  "refresh_token": "1//xxxx",
  "scope": "https://www.googleapis.com/auth/calendar.readonly",
  "calendar_id": "primary"
}
```

`calendar_id` が未設定の場合は CalendarList API からプライマリカレンダーを自動取得。

### 初回認証

Admin Console の Google Calendar サービス設定画面から OAuth フローを実行：

1. `client_id` と `client_secret` を設定
2. 「OAuth認証を開始」ボタンをクリック
3. Google アカウントで認可
4. コールバックで `access_token` と `refresh_token` が自動保存

## API仕様

### エンドポイント

| データ型 | エンドポイント | メソッド |
|---------|-------------|---------|
| Events | `/calendar/v3/calendars/{calendarId}/events` | GET |
| Colors | `/calendar/v3/colors` | GET |
| CalendarList | `/calendar/v3/users/me/calendarList` | GET |
| Calendars | `/calendar/v3/calendars/{calendarId}` | GET |

### リクエストパラメータ（Events）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| timeMin | 開始日時（RFC3339） | "2025-11-28T00:00:00+09:00" |
| timeMax | 終了日時（RFC3339） | "2025-12-02T23:59:59+09:00" |
| singleEvents | 繰り返しイベントを展開 | true |
| orderBy | ソート順 | "startTime" |
| maxResults | 1ページの最大件数 | 2500 |

### レート制限

| 項目 | 内容 |
|------|------|
| 日次クォータ | 100万リクエスト/日（プロジェクト単位） |
| 超過時 | HTTP 429 (Too Many Requests) |
| 対処法 | Retry-After ヘッダーに従い待機 |

## データベーススキーマ

raw層テーブル（JSONB形式）:

### raw.google_calendar__events

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK（自動生成） |
| source_id | TEXT | NO | UNIQUE: {calendar_id}:{event_id} |
| data | JSONB | NO | APIレスポンス全体 |
| api_version | TEXT | NO | "v3" |
| synced_at | TIMESTAMPTZ | NO | 同期日時 |

### raw.google_calendar__colors

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK（自動生成） |
| source_id | TEXT | NO | UNIQUE: "event" or "calendar" |
| data | JSONB | NO | カラー定義 |
| api_version | TEXT | NO | "v3" |
| synced_at | TIMESTAMPTZ | NO | 同期日時 |

### raw.google_calendar__calendar_list

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK（自動生成） |
| source_id | TEXT | NO | UNIQUE: calendar_id |
| data | JSONB | NO | カレンダーエントリ |
| api_version | TEXT | NO | "v3" |
| synced_at | TIMESTAMPTZ | NO | 同期日時 |

### raw.google_calendar__calendars

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK（自動生成） |
| source_id | TEXT | NO | UNIQUE: calendar_id |
| data | JSONB | NO | カレンダーメタデータ |
| api_version | TEXT | NO | "v3" |
| synced_at | TIMESTAMPTZ | NO | 同期日時 |

## Staging層

dbt モデルで raw 層の JSONB を展開:

| モデル | 説明 |
|--------|------|
| `stg_google_calendar__events` | イベント（event_id で重複排除） |
| `stg_google_calendar__colors` | カラーパレット（展開済み） |
| `stg_google_calendar__calendar_list` | カレンダーリスト |
| `stg_google_calendar__calendars` | カレンダーメタデータ |

### イベントの重複排除

同一 `event_id` が複数回同期された場合、最新の `synced_at` を持つレコードを採用:

```sql
row_number() over (
    partition by data->>'id'
    order by synced_at desc
) as rn
...
where rn = 1
```

## 終日イベントの変換

```python
# API レスポンス（終日イベント）
{ "start": { "date": "2025-12-25" } }

# staging層での変換
{
  "start_at": "2025-12-25T00:00:00+00:00",
  "is_all_day": true
}
```

## 処理フロー

### 日次同期（sync_all）

```
1. sync_all(days=3) 呼び出し
2. マスターデータ同期（sync_masters）
   - colors, calendar_list, calendars を並列取得
3. イベント同期（sync_events）
   - 指定日数分のイベントを取得
   - 2500件超はページネーションで自動処理
4. raw層にJSONB形式で保存
```

## 使用方法

```python
# 日次同期（マスター + イベント）
from pipelines.services.google_calendar.orchestrator import sync_all
result = await sync_all(days=3)

# イベントのみ同期
from pipelines.services.google_calendar.sync_events import sync_events
result = await sync_events(days=7)

# マスターのみ同期
from pipelines.services.google_calendar.sync_masters import sync_masters
result = await sync_masters()
```

## GitHub Actions

| ワークフロー | 説明 | トリガー |
|-------------|------|---------|
| `sync-google-calendar.yml` | 日次同期 | 手動 |
| `sync-daily.yml` | 全サービス同期 | 手動/スケジュール |

## Toggl Track との対応

| Google Calendar (予定) | Toggl Track (実績) | 備考 |
|------------------|-------------------|------|
| description | client | プロジェクト/案件 |
| summary | description | 具体的な作業内容 |
| color_id | project.color | 時間の質的分類 |
| start_at / end_at | start / stop | 時間帯 |

## 制限事項

| 制限 | 説明 |
|------|------|
| 単一カレンダー | 複数カレンダー非対応（プライマリのみ） |
| キャンセルイベント | 削除検出は未実装 |

## 参考資料

- [Google Calendar API](https://developers.google.com/calendar/api)
- [Google Calendar API v3 Reference](https://developers.google.com/calendar/api/v3/reference)
- [Events Resource](https://developers.google.com/calendar/api/v3/reference/events)
