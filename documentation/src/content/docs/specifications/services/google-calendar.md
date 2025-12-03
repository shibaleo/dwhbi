---
title: Google Calendar 仕様
description: Google Calendar 同期モジュールの仕様
---

# Google Calendar 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/gcalendar.py` |
| 認証方式 | OAuth 2.0 |
| API | Google Calendar API v3 |

## 概要

Google Calendar API v3 からイベントデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- カレンダーイベント
  - 通常イベント（時刻指定あり）
  - 終日イベント（時刻指定なし）
  - 繰り返しイベント（展開済み）

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | OAuth 2.0 Authorization Code Flow |
| トークン有効期限 | 1時間 |
| リフレッシュ閾値 | 5分前 |

### 必要な認証情報

```json
{
  "client_id": "xxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxxx",
  "access_token": "ya29.xxxx",
  "refresh_token": "1//xxxx",
  "scope": "https://www.googleapis.com/auth/calendar.events",
  "calendar_id": "primary"
}
```

### 初回認証

```bash
python scripts/init_gcalendar_oauth.py
```

## API仕様

### エンドポイント

| データ型 | エンドポイント | メソッド |
|---------|-------------|---------|
| Events | `/calendar/v3/calendars/{calendarId}/events` | GET |

### リクエストパラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| timeMin | 開始日時（RFC3339） | "2025-11-28T00:00:00Z" |
| timeMax | 終了日時（RFC3339） | "2025-12-02T00:00:00Z" |
| singleEvents | 繰り返しイベントを展開 | true |
| orderBy | ソート順 | "startTime" |
| maxResults | 1ページの最大件数 | 2500 |

### レート制限

- 100万リクエスト/日（プロジェクト単位）

## データベーススキーマ

### raw.gcalendar_events

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK（Google Calendar イベントID） |
| calendar_id | TEXT | NO | カレンダーID |
| summary | TEXT | YES | イベント名 |
| description | TEXT | YES | イベント詳細 |
| start_time | TIMESTAMPTZ | NO | 開始日時 |
| end_time | TIMESTAMPTZ | NO | 終了日時 |
| duration_ms | BIGINT | - | 期間ミリ秒（GENERATED） |
| is_all_day | BOOLEAN | YES | 終日イベントフラグ |
| color_id | TEXT | YES | カラーID |
| status | TEXT | YES | confirmed/tentative/cancelled |
| recurring_event_id | TEXT | YES | 繰り返しイベントの親ID |
| etag | TEXT | YES | 変更検出用ETag |
| updated | TIMESTAMPTZ | YES | イベント更新日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### duration_ms の計算式

```sql
duration_ms BIGINT GENERATED ALWAYS AS (
    EXTRACT(epoch FROM (end_time - start_time)) * 1000
) STORED
```

## 終日イベントの変換

```python
# API レスポンス
{ "start": { "date": "2025-12-25" } }

# DB 保存形式
{
  "start_time": "2025-12-25T00:00:00+09:00",
  "is_all_day": true
}
```

## Toggl Track との対応

| Google Calendar (予定) | Toggl Track (実績) | 備考 |
|------------------|-------------------|------|
| description | client | プロジェクト/案件 |
| summary | description | 具体的な作業内容 |
| color_id | project.color | 時間の質的分類 |
| start_time / end_time | start / stop | 時間帯 |
| duration_ms | duration_ms | 期間（ミリ秒） |

## 制限事項

| 制限 | 説明 |
|------|------|
| 単一カレンダー | 複数カレンダー非対応 |
| キャンセルイベント | 削除検出は未実装 |

## 参考資料

- [Google Calendar API](https://developers.google.com/calendar/api)
