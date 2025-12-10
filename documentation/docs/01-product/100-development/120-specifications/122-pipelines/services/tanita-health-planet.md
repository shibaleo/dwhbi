---
title: Tanita Health Planet 仕様
description: Tanita Health Planet 同期モジュールの仕様
---

# Tanita Health Planet 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/tanita.py` |
| 認証方式 | OAuth 2.0 |
| API | Tanita Health Planet API |

## 概要

Tanita Health Planet API から体組成データ・血圧データを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- 体組成データ（体重、体脂肪率）
- 血圧データ（最高血圧、最低血圧、脈拍）

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | OAuth 2.0 Authorization Code Flow |
| トークン有効期限 | 3時間 |
| リフレッシュ閾値 | 30分前 |

### 必要な認証情報

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "access_token": "xxx",
  "refresh_token": "yyy",
  "scope": "innerscan,sphygmomanometer"
}
```

## API仕様

### エンドポイント

| データ型 | エンドポイント | 説明 |
|---------|-------------|------|
| 体組成 | `/status/innerscan.json` | 体重・体脂肪率等 |
| 血圧 | `/status/sphygmomanometer.json` | 血圧・脈拍 |

### リクエストパラメータ

| パラメータ | 説明 | 形式 |
|-----------|------|------|
| access_token | アクセストークン | - |
| date | 取得方法 | "1"（期間指定） |
| from | 開始日時 | yyyyMMddHHmmss（14桁） |
| to | 終了日時 | yyyyMMddHHmmss（14桁） |
| tag | 測定項目タグ | カンマ区切り |

### 測定タグ

**体組成 (innerscan)**:

| タグ | 項目 | 単位 | 状態 |
|------|------|------|------|
| 6021 | 体重 | kg | 有効 |
| 6022 | 体脂肪率 | % | 有効 |
| 6023-6029 | 筋肉量等 | - | 廃止 (2020/6/29) |

**血圧 (sphygmomanometer)**:

| タグ | 項目 | 単位 |
|------|------|------|
| 622E | 最高血圧 | mmHg |
| 622F | 最低血圧 | mmHg |
| 6230 | 脈拍 | bpm |

## データベーススキーマ

### raw.tanita_body_composition

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| measured_at | TIMESTAMPTZ | NO | UNIQUE, 測定日時 |
| weight | NUMERIC | YES | 体重 (kg) |
| body_fat_percent | NUMERIC | YES | 体脂肪率 (%) |
| model | TEXT | YES | 測定機器 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.tanita_blood_pressure

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| measured_at | TIMESTAMPTZ | NO | UNIQUE, 測定日時 |
| systolic | INTEGER | YES | 最高血圧 (mmHg) |
| diastolic | INTEGER | YES | 最低血圧 (mmHg) |
| pulse | INTEGER | YES | 脈拍 (bpm) |
| model | TEXT | YES | 測定機器 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## 日付フォーマット

- リクエスト: 14桁 (`yyyyMMddHHmmss`)
- レスポンス: 12桁 (`yyyyMMddHHmm`)

```python
def format_tanita_date(dt: datetime) -> str:
    """14桁形式"""
    return dt.strftime("%Y%m%d%H%M%S")

def parse_tanita_date(date_str: str) -> str:
    """12桁→ISO8601 UTC"""
    dt_naive = datetime.strptime(date_str, "%Y%m%d%H%M")
    dt_jst = dt_naive.replace(tzinfo=ZoneInfo("Asia/Tokyo"))
    dt_utc = dt_jst.astimezone(timezone.utc)
    return dt_utc.isoformat()
```

## 制限事項

| 制限 | 説明 |
|------|------|
| データ取得制限 | 3ヶ月/リクエスト |
| 文字エンコーディング | Shift_JIS応答の可能性あり |

## 参考資料

- [Health Planet API仕様書](https://www.healthplanet.jp/apis/api.html)
