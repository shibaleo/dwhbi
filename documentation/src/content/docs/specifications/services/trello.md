---
title: Trello 仕様
description: Trello 同期モジュールの仕様
---

# Trello 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/trello.py` |
| 認証方式 | API Key + Token |
| API | Trello REST API |

## 概要

Trello API からボード、リスト、ラベル、カード、アクション、チェックリスト、カスタムフィールドのデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- ボード
- リスト
- ラベル
- カード
- アクション（差分同期対応）
- チェックリスト / チェックアイテム
- カスタムフィールド定義・値

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | Query Parameter |
| ヘッダー | `?key={api_key}&token={api_token}` |
| トークン有効期限 | なし（永続） |

### 必要な認証情報

```json
{
  "api_key": "your_trello_api_key",
  "api_token": "your_trello_api_token"
}
```

API Keyは https://trello.com/app-key から取得。

## API仕様

### エンドポイント

| データ型 | エンドポイント | パラメータ |
|---------|-------------|-----------|
| Boards | `/1/members/{id}/boards` | filter=open |
| Lists | `/1/boards/{id}/lists` | filter=all |
| Labels | `/1/boards/{id}/labels` | - |
| Cards | `/1/boards/{id}/cards` | filter=all |
| Actions | `/1/boards/{id}/actions` | since, limit=1000 |
| Checklists | `/1/boards/{id}/checklists` | checkItems=all |
| CustomFields | `/1/boards/{id}/customFields` | - |
| CustomFieldItems | `/1/cards/{id}/customFieldItems` | - |

### レート制限

- 100リクエスト/10秒/トークン

## データベーススキーマ

### raw.trello_boards

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| name | TEXT | NO | ボード名 |
| description | TEXT | YES | 説明 |
| url | TEXT | YES | URL |
| is_closed | BOOLEAN | YES | クローズ済みか |
| date_last_activity | TIMESTAMPTZ | YES | 最終アクティビティ |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.trello_lists

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| board_id | TEXT | NO | FK |
| name | TEXT | NO | リスト名 |
| pos | NUMERIC | YES | 位置 |
| is_closed | BOOLEAN | YES | クローズ済みか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.trello_cards

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| board_id | TEXT | NO | FK |
| list_id | TEXT | NO | FK |
| name | TEXT | NO | カード名 |
| description | TEXT | YES | 説明 |
| pos | NUMERIC | YES | 位置 |
| is_closed | BOOLEAN | YES | クローズ済みか |
| due | TIMESTAMPTZ | YES | 期限 |
| due_complete | BOOLEAN | YES | 完了済みか |
| id_labels | TEXT[] | YES | ラベルID配列 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.trello_actions

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| board_id | TEXT | YES | ボードID |
| card_id | TEXT | YES | カードID |
| type | TEXT | NO | アクションタイプ |
| date | TIMESTAMPTZ | NO | 実行日時 |
| data | JSONB | YES | アクションデータ |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.trello_checklists / raw.trello_checkitems

チェックリストとチェックアイテムを別テーブルで管理し、アイテムごとの状態（complete/incomplete）を追跡可能。

## 差分同期

アクションは `since` パラメータで差分取得：

```python
# 最終アクション日時を取得
last_date = get_last_action_date()

# 差分取得
GET /boards/{id}/actions?since={last_date}
```

## 制限事項

| 制限 | 説明 |
|------|------|
| アクション上限 | 1回の取得で最大1000件 |
| メンバー詳細未対応 | メンバーIDのみ保存 |

## 参考資料

- [Trello REST API](https://developer.atlassian.com/cloud/trello/rest/)
