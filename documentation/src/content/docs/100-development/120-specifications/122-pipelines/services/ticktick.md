---
title: TickTick 仕様
description: TickTick 同期モジュールの仕様
---

# TickTick 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/ticktick.py` |
| 認証方式 | OAuth 2.0 |
| API | TickTick Open API |

## 概要

TickTick Open API からプロジェクト、タスク、完了済みタスクのデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- プロジェクト（タスクリスト）
- アクティブなタスク
- 完了済みタスク（日付範囲指定）

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | OAuth 2.0 Authorization Code Flow |
| トークン有効期限 | 約6ヶ月 |
| リフレッシュ閾値 | 60分前 |

### 必要な認証情報

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "access_token": "xxx-xxx-xxx",
  "refresh_token": "yyy-yyy-yyy",
  "token_type": "Bearer",
  "scope": "tasks:read tasks:write"
}
```

### 初回認証

```bash
python scripts/init_ticktick_oauth.py
```

## API仕様

### エンドポイント

| データ型 | エンドポイント | 説明 |
|---------|-------------|------|
| Projects | `/open/v1/project` | プロジェクト一覧 |
| Tasks | `/open/v1/project/{id}/data` | プロジェクト内タスク |
| Completed | `/open/v1/project/{id}/completed` | 完了済みタスク |
| Token | `/oauth/token` | トークン取得/更新 |

### リクエストパラメータ（完了タスク）

| パラメータ | 説明 | 形式 |
|-----------|------|------|
| from | 開始日時 | YYYY-MM-DDTHH:mm:ss+0000 |
| to | 終了日時 | YYYY-MM-DDTHH:mm:ss+0000 |

## データベーススキーマ

### raw.ticktick_projects

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| name | TEXT | NO | プロジェクト名 |
| color | TEXT | YES | カラー |
| sort_order | BIGINT | YES | 並び順 |
| view_mode | TEXT | YES | 表示モード |
| kind | TEXT | YES | 種類 |
| is_owner | BOOLEAN | YES | オーナーか |
| closed | BOOLEAN | YES | アーカイブ済みか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.ticktick_tasks

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| project_id | TEXT | YES | FK |
| title | TEXT | NO | タスク名 |
| content | TEXT | YES | 内容（マークダウン） |
| priority | INTEGER | YES | 優先度（0:なし, 1:低, 3:中, 5:高） |
| status | INTEGER | YES | ステータス（0:未完了, 2:完了） |
| due_date | TIMESTAMPTZ | YES | 期限 |
| completed_time | TIMESTAMPTZ | YES | 完了日時 |
| tags | TEXT[] | YES | タグ配列 |
| items | JSONB | YES | サブタスク |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.ticktick_completed_tasks

完了済みタスク専用テーブル。アクティブタスクと同じスキーマで `completed_time` が必須。

## 制限事項

| 制限 | 説明 |
|------|------|
| 完了タスクの日付制限 | 日付範囲指定が必須 |
| サブタスク | items として JSONB 保存 |
| refresh_token | 返さない場合あり |

## 参考資料

- [TickTick Open API](https://developer.ticktick.com/api)
