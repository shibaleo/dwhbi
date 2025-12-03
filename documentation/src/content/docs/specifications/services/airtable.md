---
title: Airtable 仕様
description: Airtable 同期モジュールの仕様
---

# Airtable 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/airtable.py` |
| 認証方式 | Personal Access Token (PAT) |
| API | Airtable Web API |

## 概要

Airtable Web API からベース、テーブル（スキーマ情報含む）、レコードのデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- ベース（データベース）
- テーブル定義（フィールド、ビュー）
- レコード（オプション）

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | Bearer Token |
| トークン有効期限 | PAT設定に依存 |
| ヘッダー | `Authorization: Bearer {pat}` |

### 必要な認証情報

```json
{
  "personal_access_token": "patXXX.XXXXXX..."
}
```

### 必要なスコープ

| スコープ | 説明 |
|---------|------|
| data.records:read | レコード読み取り |
| schema.bases:read | スキーマ読み取り |

## API仕様

### エンドポイント

| データ型 | エンドポイント | 説明 |
|---------|-------------|------|
| Bases | `/v0/meta/bases` | ベース一覧 |
| Tables | `/v0/meta/bases/{baseId}/tables` | テーブル一覧（スキーマ含む） |
| Records | `/v0/{baseId}/{tableIdOrName}` | レコード一覧 |

### レート制限

- 5リクエスト/秒
- 0.2秒間隔で待機

## データベーススキーマ

### raw.airtable_bases

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK (appXXX) |
| name | TEXT | NO | ベース名 |
| permission_level | TEXT | YES | 権限レベル |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.airtable_tables

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK (tblXXX) |
| base_id | TEXT | NO | FK |
| name | TEXT | NO | テーブル名 |
| primary_field_id | TEXT | YES | プライマリフィールドID |
| fields | JSONB | YES | フィールド定義 |
| views | JSONB | YES | ビュー定義 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.airtable_records

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK (recXXX) |
| base_id | TEXT | NO | ベースID |
| table_id | TEXT | NO | テーブルID |
| created_time | TIMESTAMPTZ | NO | 作成日時 |
| fields | JSONB | YES | フィールド値 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## 実行オプション

```python
# 全ベース同期
sync_airtable()

# 特定ベースのみ
sync_airtable(base_ids=['appXXXXXXXX'])

# スキーマのみ（レコードなし）
sync_airtable(include_records=False)
```

## 制限事項

| 制限 | 説明 |
|------|------|
| レート制限 | 5リクエスト/秒 |
| ページサイズ | 最大100件/リクエスト |
| フィールド値 | JSONB として保存 |

## 参考資料

- [Airtable Web API](https://airtable.com/developers/web/api)
- [Personal Access Tokens](https://airtable.com/developers/web/guides/personal-access-tokens)
