---
title: Zaim 仕様
description: Zaim 同期モジュールの仕様
---

# Zaim 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/zaim.py` |
| 認証方式 | OAuth 1.0a (HMAC-SHA1署名) |
| API | Zaim API v2 |

## 概要

Zaim API v2 から家計簿データを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- カテゴリ
- ジャンル
- 口座
- 取引（payment/income/transfer）

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | OAuth 1.0a |
| 署名方式 | HMAC-SHA1 |
| トークン有効期限 | なし（永続） |

### 必要な認証情報

```json
{
  "consumer_key": "your_consumer_key",
  "consumer_secret": "your_consumer_secret",
  "access_token": "your_access_token",
  "access_token_secret": "your_access_token_secret"
}
```

## API仕様

### エンドポイント

| データ型 | エンドポイント | メソッド |
|---------|-------------|---------|
| User | `/home/user/verify` | GET |
| Categories | `/home/category` | GET |
| Genres | `/home/genre` | GET |
| Accounts | `/home/account` | GET |
| Transactions | `/home/money` | GET |

### レート制限

- 非公開（厳しくない）

## データベーススキーマ

### raw.zaim_categories

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK（複合） |
| zaim_user_id | BIGINT | NO | PK（複合） |
| name | TEXT | NO | カテゴリ名 |
| sort_order | INTEGER | NO | 表示順 |
| mode | TEXT | NO | payment / income |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.zaim_genres

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK（複合） |
| zaim_user_id | BIGINT | NO | PK（複合） |
| category_id | BIGINT | NO | FK → zaim_categories.id |
| name | TEXT | NO | ジャンル名 |
| sort_order | INTEGER | NO | 表示順 |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.zaim_accounts

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK（複合） |
| zaim_user_id | BIGINT | NO | PK（複合） |
| name | TEXT | NO | 口座名 |
| sort_order | INTEGER | NO | 表示順 |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.zaim_transactions

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| zaim_user_id | BIGINT | NO | PK（複合） |
| zaim_id | BIGINT | NO | PK（複合） |
| transaction_type | TEXT | NO | payment/income/transfer |
| amount | INTEGER | NO | 金額 |
| date | DATE | NO | 取引日 |
| created_at | TIMESTAMPTZ | NO | 作成日時（UTC） |
| modified_at | TIMESTAMPTZ | YES | 更新日時（UTC） |
| category_id | BIGINT | YES | FK → zaim_categories.id |
| genre_id | BIGINT | YES | FK → zaim_genres.id |
| from_account_id | BIGINT | YES | FK → zaim_accounts.id |
| to_account_id | BIGINT | YES | FK → zaim_accounts.id |
| place | TEXT | YES | 店舗・場所 |
| name | TEXT | YES | 品目名 |
| comment | TEXT | YES | コメント |
| is_active | BOOLEAN | YES | アクティブか |
| receipt_id | BIGINT | YES | レシートID |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## 保存順序

外部キー制約により順序が制約される：

1. categories
2. genres（categories依存）
3. accounts
4. transactions（genres, accounts依存）

## タイムスタンプ変換

Zaim APIはtz情報なしのJST時刻を返す：

```python
def convert_zaim_timestamp_to_utc(jst_str: str) -> str:
    # "2025-11-24 20:43:44" → "2025-11-24T11:43:44+00:00"
    dt_naive = datetime.strptime(jst_str, "%Y-%m-%d %H:%M:%S")
    dt_jst = dt_naive.replace(tzinfo=ZoneInfo("Asia/Tokyo"))
    dt_utc = dt_jst.astimezone(timezone.utc)
    return dt_utc.isoformat()
```

## 特殊処理

### account_id=0 の変換

Zaim APIは「未指定」を0で表現。外部キー制約のためNULLに変換：

```python
from_account_id = tx.get("from_account_id")
if from_account_id == 0:
    from_account_id = None
```

## 制限事項

| 制限 | 説明 |
|------|------|
| 差分同期未実装 | 毎回全件取得（指定日数分） |
| 単一ユーザー | 複数ユーザー非対応 |
