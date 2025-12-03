---
title: Fitbit 仕様
description: Fitbit 同期モジュールの仕様
---

# Fitbit 仕様

| 項目 | 内容 |
|------|------|
| 対象ファイル | `pipelines/services/fitbit.py` |
| 認証方式 | OAuth 2.0 |
| API | Fitbit Web API |

## 概要

Fitbit Web API からヘルスデータを取得し、Supabase の `raw` スキーマに保存する。

### 同期対象

- 睡眠ログ (Sleep)
- 日次心拍数 (Heart Rate)
- 日次HRV (Heart Rate Variability)
- 日次活動サマリー (Activity)
- 日次SpO2 (血中酸素飽和度)

## 認証

| 項目 | 内容 |
|------|------|
| 認証方式 | OAuth 2.0 Authorization Code Flow |
| トークン有効期限 | 8時間 |
| リフレッシュ閾値 | 60分前 |

### 必要な認証情報

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "access_token": "ya29.xxxx",
  "refresh_token": "1//xxxx"
}
```

## API仕様

### エンドポイント

| データ型 | エンドポイント | チャンク |
|---------|-------------|---------|
| Sleep | `/1.2/user/-/sleep/date/{start}/{end}.json` | 100日 |
| Heart Rate | `/1/user/-/activities/heart/date/{start}/{end}.json` | 30日 |
| HRV | `/1/user/-/hrv/date/{start}/{end}.json` | 30日 |
| Activity | `/1/user/-/activities/date/{date}.json` | 1日 |
| SpO2 | `/1/user/-/spo2/date/{date}.json` | 1日 |

### レート制限

- 150 requests/hour（ユーザーごと）
- 429エラー時は Retry-After ヘッダーを確認

## データベーススキーマ

### raw.fitbit_sleep_logs

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| log_id | BIGINT | NO | PK |
| date | DATE | NO | 睡眠日 |
| start_time | TIMESTAMPTZ | NO | 開始時刻（UTC） |
| end_time | TIMESTAMPTZ | NO | 終了時刻（UTC） |
| duration_ms | BIGINT | NO | 睡眠時間（ミリ秒） |
| efficiency | INTEGER | YES | 睡眠効率 |
| is_main_sleep | BOOLEAN | YES | メイン睡眠か |
| minutes_asleep | INTEGER | YES | 睡眠分数 |
| minutes_awake | INTEGER | YES | 覚醒分数 |
| time_in_bed | INTEGER | YES | ベッド滞在分数 |
| sleep_type | TEXT | YES | stages / classic |
| levels_summary | JSONB | YES | ステージ別サマリー |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_heart_rate_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| date | DATE | NO | PK |
| resting_heart_rate | INTEGER | YES | 安静時心拍数 |
| heart_rate_zones | JSONB | YES | ゾーン別データ |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_hrv_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| date | DATE | NO | PK |
| daily_rmssd | NUMERIC | YES | 日次RMSSD |
| deep_rmssd | NUMERIC | YES | 深睡眠時RMSSD |
| intraday | JSONB | YES | 詳細データ |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_activity_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| date | DATE | NO | PK |
| steps | INTEGER | YES | 歩数 |
| distance_km | NUMERIC | YES | 距離（km） |
| floors | INTEGER | YES | 階数 |
| calories_total | INTEGER | YES | 総カロリー |
| calories_bmr | INTEGER | YES | 基礎代謝 |
| calories_activity | INTEGER | YES | 活動カロリー |
| sedentary_minutes | INTEGER | YES | 座位時間 |
| lightly_active_minutes | INTEGER | YES | 軽活動時間 |
| fairly_active_minutes | INTEGER | YES | 中活動時間 |
| very_active_minutes | INTEGER | YES | 高活動時間 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_spo2_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| date | DATE | NO | PK |
| avg_spo2 | NUMERIC | YES | 平均SpO2 |
| min_spo2 | NUMERIC | YES | 最小SpO2 |
| max_spo2 | NUMERIC | YES | 最大SpO2 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## タイムゾーン変換

Fitbit APIはタイムゾーン情報なしのISO8601文字列を返す。JSTとして扱いUTCに変換：

```python
def convert_jst_to_utc(jst_time_str: str) -> str:
    dt_naive = datetime.fromisoformat(jst_time_str)
    dt_jst = dt_naive.replace(tzinfo=ZoneInfo("Asia/Tokyo"))
    dt_utc = dt_jst.astimezone(timezone.utc)
    return dt_utc.isoformat()
```

## 制限事項

| 制限 | 説明 |
|------|------|
| データ型ごとの取得制限 | Sleep: 100日、HR/HRV: 30日、Activity/SpO2: 1日 |
| 3データ型未対応 | Breathing Rate, Cardio Score, Temperature Skin |

## 参考資料

- [Fitbit Web API Reference](https://dev.fitbit.com/build/reference/web-api/)
- [OAuth 2.0 Authorization](https://dev.fitbit.com/build/reference/web-api/authorization/)
