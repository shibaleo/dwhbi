# LIFETRACER テーブル定義書

| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 2.0.0 |
| 最終更新日 | 2025-12-01 |
| 対象スキーマ | raw, staging, core, marts, credentials |

## 目次

- [1. スキーマ概要](#1-スキーマ概要)
- [2. Toggl Track テーブル](#2-toggl-track-テーブル)
- [3. Google Calendar テーブル](#3-google-calendar-テーブル)
- [4. Zaim テーブル](#4-zaim-テーブル)
- [5. Fitbit テーブル](#5-fitbit-テーブル)
- [6. Tanita テーブル](#6-tanita-テーブル)
- [7. 認証情報テーブル](#7-認証情報テーブル)
- [8. staging層設計](#8-staging層設計)
- [9. core層設計](#9-core層設計)
- [10. marts層設計](#10-marts層設計)
- [11. LLM分析のためのデータ設計](#11-llm分析のためのデータ設計)

---

## 1. スキーマ概要

### 1.1 スキーマ一覧

| スキーマ | 役割 | 形式 | 実装状況 |
|---------|------|------|---------|
| `raw` | 外部APIからの生データ | テーブル | ✅ 実装済み |
| `staging` | クリーニング・正規化 | ビュー | 未実装 |
| `core` | サービス統合（サービス名が消える） | ビュー | 未実装 |
| `marts` | 分析集計・LLM向けビュー | ビュー | 未実装 |
| `credentials` | 認証情報（暗号化） | テーブル | ✅ 実装済み |

### 1.2 raw スキーマ テーブル一覧

| テーブル | 主キー | データソース | 説明 | 実装状況 |
|---------|--------|------------|------|---------|
| `raw.toggl_clients` | id | Toggl | クライアント | ✅ |
| `raw.toggl_projects` | id | Toggl | プロジェクト | ✅ |
| `raw.toggl_tags` | id | Toggl | タグ | ✅ |
| `raw.toggl_entries` | id | Toggl | 時間エントリー | ✅ |
| `raw.gcalendar_events` | id | Google Calendar | カレンダーイベント | ✅ |
| `raw.zaim_categories` | (zaim_user_id, id) | Zaim | カテゴリ | ✅ |
| `raw.zaim_genres` | (zaim_user_id, id) | Zaim | ジャンル | ✅ |
| `raw.zaim_accounts` | (zaim_user_id, id) | Zaim | 口座 | ✅ |
| `raw.zaim_transactions` | (zaim_user_id, zaim_id) | Zaim | 取引 | ✅ |
| `raw.fitbit_sleep` | log_id | Fitbit | 睡眠ログ | ✅ |
| `raw.fitbit_heart_rate_daily` | date | Fitbit | 日次心拍数 | ✅ |
| `raw.fitbit_hrv_daily` | date | Fitbit | 日次HRV | ✅ |
| `raw.fitbit_activity_daily` | date | Fitbit | 日次活動 | ✅ |
| `raw.fitbit_spo2_daily` | date | Fitbit | 日次SpO2 | ✅ |
| `raw.fitbit_breathing_rate_daily` | date | Fitbit | 日次呼吸数 | ✅ |
| `raw.fitbit_cardio_score_daily` | date | Fitbit | 日次VO2Max | ✅ |
| `raw.fitbit_temperature_skin_daily` | date | Fitbit | 日次皮膚温度 | ✅ |
| `raw.tanita_body_composition` | measured_at | Tanita | 体組成 | ✅ |
| `raw.tanita_blood_pressure` | measured_at | Tanita | 血圧 | ✅ |
| `raw.tanita_steps` | measured_at | Tanita | 歩数 | DB有り、同期未実装 |

---

## 2. Toggl Track テーブル

### 2.1 raw.toggl_clients

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | BIGINT | NO | - | PK | ✅ |
| workspace_id | BIGINT | NO | - | ワークスペースID | ✅ |
| name | TEXT | NO | - | クライアント名 | ✅ |
| is_archived | BOOLEAN | YES | false | アーカイブ済みか | ✅ |
| created_at | TIMESTAMPTZ | NO | - | 作成日時 | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 2.2 raw.toggl_projects

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | BIGINT | NO | - | PK | ✅ |
| workspace_id | BIGINT | NO | - | ワークスペースID | ✅ |
| client_id | BIGINT | YES | - | FK → toggl_clients.id | ✅ |
| name | TEXT | NO | - | プロジェクト名 | ✅ |
| color | TEXT | YES | - | カラーコード | ✅ |
| is_private | BOOLEAN | YES | false | プライベートか | ✅ |
| is_active | BOOLEAN | YES | true | アクティブか | ✅ |
| is_billable | BOOLEAN | YES | false | 課金対象か | ✅ |
| created_at | TIMESTAMPTZ | NO | - | 作成日時 | ✅ |
| archived_at | TIMESTAMPTZ | YES | - | アーカイブ日時 | ✅ |
| estimated_hours | NUMERIC | YES | - | 見積時間 | - |
| estimated_seconds | BIGINT | YES | - | 見積秒数 | - |
| rate | NUMERIC | YES | - | 時間単価 | - |
| rate_last_updated | TIMESTAMPTZ | YES | - | 単価更新日 | - |
| currency | TEXT | YES | - | 通貨 | - |
| is_template | BOOLEAN | YES | false | テンプレートか | - |
| template_id | BIGINT | YES | - | テンプレートID | - |
| auto_estimates | BOOLEAN | YES | - | 自動見積 | - |
| recurring | BOOLEAN | YES | false | 繰り返しか | - |
| recurring_parameters | JSONB | YES | - | 繰り返しパラメータ | - |
| fixed_fee | NUMERIC | YES | - | 固定費用 | - |
| can_track_time | BOOLEAN | YES | true | 時間記録可能か | - |
| start_date | DATE | YES | - | 開始日 | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**: Python実装では基本カラムのみ使用。DBには課金・見積関連の追加カラムが存在。

### 2.3 raw.toggl_tags

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | BIGINT | NO | - | PK | ✅ |
| workspace_id | BIGINT | NO | - | ワークスペースID | ✅ |
| name | TEXT | NO | - | タグ名 | ✅ |
| created_at | TIMESTAMPTZ | NO | - | 作成日時 | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 2.4 raw.toggl_entries

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | BIGINT | NO | - | PK | ✅ |
| workspace_id | BIGINT | NO | - | ワークスペースID | ✅ |
| project_id | BIGINT | YES | - | FK → toggl_projects.id | ✅ |
| task_id | BIGINT | YES | - | タスクID | ✅ |
| user_id | BIGINT | YES | - | ユーザーID | ✅ |
| description | TEXT | YES | - | 説明 | ✅ |
| start | TIMESTAMPTZ | NO | - | 開始時刻 | ✅ |
| end | TIMESTAMPTZ | NO | - | 終了時刻 | ✅ |
| duration_ms | BIGINT | NO | - | 期間ミリ秒 | ✅ |
| is_billable | BOOLEAN | YES | false | 課金対象か | ✅ |
| billable_amount | NUMERIC | YES | - | 課金額 | ✅ |
| currency | TEXT | YES | - | 通貨 | ✅ |
| tags | TEXT[] | YES | - | タグ配列 | ✅ |
| updated_at | TIMESTAMPTZ | YES | - | 更新日時 | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**:
- DB定義では `end`, `duration_ms` は NOT NULL だが、実行中エントリー対応のためPython実装では空文字列を許容
- `tags` は PostgreSQL の TEXT[] 型（配列）

---

## 3. Google Calendar テーブル

### 3.1 raw.gcalendar_events

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | TEXT | NO | - | PK | ✅ |
| calendar_id | TEXT | NO | - | カレンダーID | ✅ |
| summary | TEXT | YES | - | イベント名 | ✅ |
| description | TEXT | YES | - | イベント詳細 | ✅ |
| start_time | TIMESTAMPTZ | NO | - | 開始日時 | ✅ |
| end_time | TIMESTAMPTZ | NO | - | 終了日時 | ✅ |
| duration_ms | BIGINT | - | GENERATED | 期間ミリ秒（自動計算） | - |
| is_all_day | BOOLEAN | YES | false | 終日イベントフラグ | ✅ |
| color_id | TEXT | YES | - | カラーID | ✅ |
| status | TEXT | YES | - | ステータス | ✅ |
| recurring_event_id | TEXT | YES | - | 繰り返しイベントの親ID | ✅ |
| etag | TEXT | YES | - | 変更検出用ETag | ✅ |
| updated | TIMESTAMPTZ | YES | - | イベント更新日時 | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**:
- `duration_ms` は GENERATED カラム（自動計算）: `EXTRACT(epoch FROM (end_time - start_time)) * 1000`
- Togglと同じ単位（ミリ秒）で duration を保持し、予実比較を容易にする

---

## 4. Zaim テーブル

### 4.1 raw.zaim_categories

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | INTEGER | NO | - | Zaim カテゴリID（複合PK） | ✅ |
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（複合PK） | ✅ |
| name | VARCHAR | NO | - | カテゴリ名 | ✅ |
| sort_order | INTEGER | YES | - | 表示順 | ✅ |
| mode | VARCHAR | YES | - | "payment" or "income" | ✅ |
| is_active | BOOLEAN | YES | true | アクティブか | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 4.2 raw.zaim_genres

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | INTEGER | NO | - | Zaim ジャンルID（複合PK） | ✅ |
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（複合PK） | ✅ |
| category_id | INTEGER | NO | - | FK → zaim_categories.id | ✅ |
| name | VARCHAR | NO | - | ジャンル名 | ✅ |
| sort_order | INTEGER | YES | - | 表示順 | ✅ |
| is_active | BOOLEAN | YES | true | アクティブか | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 4.3 raw.zaim_accounts

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | INTEGER | NO | - | Zaim 口座ID（複合PK） | ✅ |
| zaim_user_id | BIGINT | NO | - | Zaim ユーザーID（複合PK） | ✅ |
| name | VARCHAR | NO | - | 口座名 | ✅ |
| sort_order | INTEGER | YES | - | 表示順 | ✅ |
| is_active | BOOLEAN | YES | true | アクティブか | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 4.4 raw.zaim_transactions

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| zaim_user_id | BIGINT | NO | - | 複合PK | ✅ |
| zaim_id | BIGINT | NO | - | 複合PK | ✅ |
| transaction_type | VARCHAR | NO | - | "payment", "income", "transfer" | ✅ |
| amount | INTEGER | NO | - | 金額 | ✅ |
| date | DATE | NO | - | 取引日 | ✅ |
| created_at | TIMESTAMPTZ | NO | - | 作成日時（UTC） | ✅ |
| modified_at | TIMESTAMPTZ | YES | - | 更新日時（UTC） | ✅ |
| category_id | INTEGER | YES | - | FK | ✅ |
| genre_id | INTEGER | YES | - | FK | ✅ |
| from_account_id | INTEGER | YES | - | FK（振替元） | ✅ |
| to_account_id | INTEGER | YES | - | FK（振替先） | ✅ |
| place | TEXT | YES | - | 店舗・場所 | ✅ |
| name | TEXT | YES | - | 品目名 | ✅ |
| comment | TEXT | YES | - | コメント | ✅ |
| is_active | BOOLEAN | YES | true | アクティブか | ✅ |
| receipt_id | BIGINT | YES | - | レシートID | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**:
- `from_account_id`, `to_account_id`: APIの0値→NULLに変換済み
- `created_at`, `modified_at`: JSTタイムスタンプをUTCに変換済み

---

## 5. Fitbit テーブル

### 5.1 raw.fitbit_sleep

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 睡眠日 | ✅ |
| start_time | TIMESTAMPTZ | NO | - | 開始時刻（UTC） | ✅ |
| end_time | TIMESTAMPTZ | NO | - | 終了時刻（UTC） | ✅ |
| duration_ms | INTEGER | YES | - | 期間ミリ秒 | ✅ |
| efficiency | INTEGER | YES | - | 睡眠効率（%） | ✅ |
| is_main_sleep | BOOLEAN | YES | true | メイン睡眠か | ✅ |
| minutes_asleep | INTEGER | YES | - | 睡眠時間（分） | ✅ |
| minutes_awake | INTEGER | YES | - | 覚醒時間（分） | ✅ |
| time_in_bed | INTEGER | YES | - | 就床時間（分） | ✅ |
| sleep_type | TEXT | YES | - | "stages" or "classic" | ✅ |
| levels | JSONB | YES | - | 睡眠段階詳細 | ✅ |
| log_id | BIGINT | NO | - | Fitbit logId（UNIQUE） | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**: `on_conflict="log_id"` で upsert

### 5.2 raw.fitbit_heart_rate_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| resting_heart_rate | INTEGER | YES | - | 安静時心拍数 | ✅ |
| heart_rate_zones | JSONB | YES | - | 心拍ゾーン配列 | ✅ |
| intraday | JSONB | YES | - | 分単位データ | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 5.3 raw.fitbit_hrv_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| daily_rmssd | NUMERIC | YES | - | 日次RMSSD（ms） | ✅ |
| deep_rmssd | NUMERIC | YES | - | 深睡眠時RMSSD | ✅ |
| intraday | JSONB | YES | - | 分単位データ | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 5.4 raw.fitbit_activity_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| steps | INTEGER | YES | - | 歩数 | ✅ |
| distance_km | NUMERIC | YES | - | 移動距離（km） | ✅ |
| floors | INTEGER | YES | - | 階数 | ✅ |
| calories_total | INTEGER | YES | - | 総消費カロリー | ✅ |
| calories_bmr | INTEGER | YES | - | 基礎代謝カロリー | ✅ |
| calories_activity | INTEGER | YES | - | 活動カロリー | ✅ |
| sedentary_minutes | INTEGER | YES | - | 座位時間（分） | ✅ |
| lightly_active_minutes | INTEGER | YES | - | 軽活動時間（分） | ✅ |
| fairly_active_minutes | INTEGER | YES | - | 中活動時間（分） | ✅ |
| very_active_minutes | INTEGER | YES | - | 高活動時間（分） | ✅ |
| active_zone_minutes | JSONB | YES | - | AZM詳細 | - |
| intraday | JSONB | YES | - | 分単位データ | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 5.5 raw.fitbit_spo2_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| avg_spo2 | NUMERIC | YES | - | 平均SpO2（%） | ✅ |
| min_spo2 | NUMERIC | YES | - | 最小SpO2（%） | ✅ |
| max_spo2 | NUMERIC | YES | - | 最大SpO2（%） | ✅ |
| intraday | JSONB | YES | - | 詳細データ | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 5.6 raw.fitbit_breathing_rate_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| breathing_rate | NUMERIC | YES | - | 平均呼吸数（回/分） | ✅ |
| intraday | JSONB | YES | - | 詳細データ | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 5.7 raw.fitbit_cardio_score_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| vo2_max | NUMERIC | YES | - | VO2 Max（mL/kg/min） | ✅ |
| vo2_max_range_low | NUMERIC | YES | - | VO2 Max下限 | ✅ |
| vo2_max_range_high | NUMERIC | YES | - | VO2 Max上限 | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

### 5.8 raw.fitbit_temperature_skin_daily

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| date | DATE | NO | - | 日付（UNIQUE） | ✅ |
| nightly_relative | NUMERIC | YES | - | 基準値からの偏差（℃） | ✅ |
| log_type | TEXT | YES | - | センサータイプ | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

---

## 6. Tanita テーブル

### 6.1 raw.tanita_body_composition

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| measured_at | TIMESTAMPTZ | NO | - | 測定日時（UTC、UNIQUE） | ✅ |
| weight | NUMERIC | YES | - | 体重（kg） | ✅ |
| body_fat_percent | NUMERIC | YES | - | 体脂肪率（%） | ✅ |
| model | TEXT | YES | - | 測定機器モデル | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**: タグ 6021（体重）, 6022（体脂肪率）を使用

### 6.2 raw.tanita_blood_pressure

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| measured_at | TIMESTAMPTZ | NO | - | 測定日時（UTC、UNIQUE） | ✅ |
| systolic | INTEGER | YES | - | 最高血圧（mmHg） | ✅ |
| diastolic | INTEGER | YES | - | 最低血圧（mmHg） | ✅ |
| pulse | INTEGER | YES | - | 脈拍（bpm） | ✅ |
| model | TEXT | YES | - | 測定機器モデル | ✅ |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**: タグ 622E（最高血圧）, 622F（最低血圧）, 6230（脈拍）を使用

### 6.3 raw.tanita_steps（未実装）

| カラム | 型 | NULL | デフォルト | 説明 | Python使用 |
|--------|-----|------|-----------|------|-----------|
| id | UUID | NO | gen_random_uuid() | PK | - |
| measured_at | TIMESTAMPTZ | NO | - | 測定日時（UTC、UNIQUE） | - |
| steps | INTEGER | YES | - | 歩数 | - |
| model | TEXT | YES | - | 測定機器モデル | - |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 | - |

**備考**: DBには存在するがPython同期は未実装

---

## 7. 認証情報テーブル

### 7.1 credentials.services

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| service | TEXT | NO | - | PK, サービス識別子 |
| auth_type | TEXT | NO | - | 認証方式 |
| credentials_encrypted | BYTEA | NO | - | AES-256-GCM暗号化済みJSON |
| nonce | BYTEA | NO | - | AES-GCM nonce (12 bytes) |
| expires_at | TIMESTAMPTZ | YES | - | トークン有効期限 |
| updated_at | TIMESTAMPTZ | YES | now() | 更新日時 |

**認証方式（auth_type）**:

| 値 | 対象サービス |
|---|------------|
| oauth2 | Fitbit, Tanita |
| oauth1 | Zaim |
| basic | Toggl |
| service_account | Google Calendar |

**暗号化仕様**:
- アルゴリズム: AES-256-GCM
- 鍵長: 256bit (32bytes)
- Nonce: 12bytes (96bit)

---

## 8. staging層設計

### 8.1 設計方針

staging層は raw 層のデータをクリーニング・正規化するビューを提供する。

**変換内容**:
- カラム名の統一（snake_case）
- タイムゾーンの統一（UTC）
- NULL値の処理
- 型の統一

### 8.2 命名規則

```
stg_{service}__{entity}
```

例: `stg_toggl__entries`, `stg_fitbit__sleep`

### 8.3 予定ビュー一覧

| ビュー | 元テーブル | 主な変換 |
|--------|----------|---------|
| `stg_toggl__entries` | raw.toggl_entries | タグ配列の正規化 |
| `stg_toggl__projects` | raw.toggl_projects | is_active の統一 |
| `stg_gcalendar__events` | raw.gcalendar_events | duration_ms の補完 |
| `stg_zaim__transactions` | raw.zaim_transactions | category/genre名の結合 |
| `stg_fitbit__sleep` | raw.fitbit_sleep | levels JSONの展開 |
| `stg_fitbit__daily_health` | 複数Fitbitテーブル | 日次健康指標の統合 |
| `stg_tanita__body_metrics` | raw.tanita_* | 体組成+血圧の統合 |

---

## 9. core層設計

### 9.1 設計方針

core層は **サービス名を隠蔽** し、ビジネスエンティティとして統合する。

**目的**:
- 将来のサービス移行（Toggl → 別サービス）に耐える
- 分析クエリがサービスに依存しない
- LLM がシンプルなスキーマを参照できる

### 9.2 命名規則

```
fct_{entity}  -- ファクトテーブル（時系列イベント）
dim_{entity}  -- ディメンションテーブル（マスタ）
```

### 9.3 予定ビュー一覧

| ビュー | 元staging | 説明 |
|--------|----------|------|
| `fct_time_entries` | stg_toggl__entries | 時間記録（実績） |
| `fct_scheduled_events` | stg_gcalendar__events | 予定 |
| `fct_transactions` | stg_zaim__transactions | 支出/収入 |
| `fct_sleep_logs` | stg_fitbit__sleep | 睡眠記録 |
| `fct_daily_health` | stg_fitbit__daily_health, stg_tanita__body_metrics | 日次健康指標 |
| `dim_projects` | stg_toggl__projects | プロジェクトマスタ |
| `dim_categories` | stg_zaim__* | カテゴリマスタ |

### 9.4 fct_time_entries 設計案

```sql
CREATE VIEW core.fct_time_entries AS
SELECT
    id,
    start_at,           -- 開始時刻（UTC）
    end_at,             -- 終了時刻（UTC）
    duration_minutes,   -- 期間（分）
    project_id,
    project_name,
    client_name,
    description,
    tags,
    is_billable,
    source              -- 'toggl' (将来: 'clockify' など)
FROM staging.stg_toggl__entries;
```

### 9.5 fct_daily_health 設計案

```sql
CREATE VIEW core.fct_daily_health AS
SELECT
    date,
    -- 睡眠
    sleep_duration_minutes,
    sleep_efficiency,
    deep_sleep_minutes,
    rem_sleep_minutes,
    -- 心拍
    resting_heart_rate,
    hrv_rmssd,
    -- 活動
    steps,
    active_minutes,
    calories_burned,
    -- 体組成
    weight_kg,
    body_fat_percent,
    -- 血圧
    blood_pressure_systolic,
    blood_pressure_diastolic,
    -- SpO2/呼吸
    avg_spo2,
    breathing_rate,
    -- メタ
    source_services     -- ['fitbit', 'tanita']
FROM (...)
```

---

## 10. marts層設計

### 10.1 設計方針

marts層は **分析・集計済み** のビューを提供し、ダッシュボードやLLM分析に使用する。

### 10.2 命名規則

```
agg_{granularity}_{domain}
```

例: `agg_daily_health`, `agg_weekly_productivity`, `agg_monthly_expense`

### 10.3 予定ビュー一覧

| ビュー | 粒度 | ドメイン | 用途 |
|--------|------|---------|------|
| `agg_daily_health` | 日次 | 健康 | 健康指標サマリー |
| `agg_daily_productivity` | 日次 | 時間 | 作業時間サマリー |
| `agg_weekly_productivity` | 週次 | 時間 | 週次振り返り |
| `agg_monthly_expense` | 月次 | 支出 | 月次支出集計 |
| `agg_monthly_income_expense` | 月次 | 支出 | 収支バランス |
| `plan_vs_actual_daily` | 日次 | 時間 | 予実比較 |

### 10.4 agg_daily_health 設計案

```sql
CREATE VIEW marts.agg_daily_health AS
SELECT
    date,
    -- 睡眠スコア（0-100）
    CASE
        WHEN sleep_efficiency >= 85 AND sleep_duration_minutes >= 420 THEN 100
        WHEN sleep_efficiency >= 80 AND sleep_duration_minutes >= 360 THEN 80
        ELSE 60
    END AS sleep_score,
    -- 活動スコア（0-100）
    CASE
        WHEN steps >= 10000 THEN 100
        WHEN steps >= 7000 THEN 80
        ELSE 60
    END AS activity_score,
    -- 回復スコア（HRV/RHRベース）
    CASE
        WHEN hrv_rmssd >= 50 AND resting_heart_rate <= 60 THEN 100
        ELSE 70
    END AS recovery_score,
    -- 総合スコア
    (sleep_score + activity_score + recovery_score) / 3 AS overall_score,
    -- 詳細
    sleep_duration_minutes,
    steps,
    resting_heart_rate,
    hrv_rmssd,
    weight_kg
FROM core.fct_daily_health;
```

---

## 11. LLM分析のためのデータ設計

### 11.1 設計目標

LLM（Claude等）が効果的に分析できるよう、以下を考慮する：

1. **シンプルなスキーマ**: 複雑なJOINを不要にする
2. **自己説明的なカラム名**: 単位を含める（`duration_minutes`, `weight_kg`）
3. **正規化されたデータ**: NULLを減らし、計算済みの値を提供
4. **コンテキスト情報**: 基準値・目標値との比較

### 11.2 LLM向けビュー

```sql
-- LLM分析用の日次サマリービュー
CREATE VIEW marts.llm_daily_summary AS
SELECT
    date,
    -- 睡眠（自然言語で解釈しやすい形式）
    sleep_duration_minutes || ' minutes of sleep (target: 480)' AS sleep_summary,
    sleep_efficiency || '% efficiency' AS sleep_quality,
    -- 活動
    steps || ' steps (target: 10000)' AS activity_summary,
    -- 健康
    'RHR: ' || resting_heart_rate || ' bpm, HRV: ' || hrv_rmssd || ' ms' AS vitals_summary,
    -- 体組成
    'Weight: ' || weight_kg || ' kg, Body Fat: ' || body_fat_percent || '%' AS body_summary,
    -- スコア
    overall_score || '/100 overall health score' AS score_summary
FROM marts.agg_daily_health;
```

### 11.3 分析クエリ例

LLMが実行する想定のクエリ：

```sql
-- 過去7日間の健康トレンド
SELECT date, overall_score, sleep_score, activity_score, recovery_score
FROM marts.agg_daily_health
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date;

-- 睡眠と生産性の相関分析用データ
SELECT
    h.date,
    h.sleep_duration_minutes,
    h.sleep_efficiency,
    p.total_work_minutes,
    p.deep_work_minutes
FROM marts.agg_daily_health h
JOIN marts.agg_daily_productivity p ON h.date = p.date
WHERE h.date >= CURRENT_DATE - INTERVAL '30 days';

-- 支出カテゴリ別月次サマリー
SELECT
    category_name,
    SUM(amount) AS total_amount,
    COUNT(*) AS transaction_count
FROM marts.agg_monthly_expense
WHERE month = DATE_TRUNC('month', CURRENT_DATE)
GROUP BY category_name
ORDER BY total_amount DESC;
```

### 11.4 データ品質チェック

LLM分析の前提となるデータ品質を保証するためのビュー：

```sql
-- データ完全性チェック
CREATE VIEW marts.data_quality_check AS
SELECT
    date,
    CASE WHEN sleep_duration_minutes IS NOT NULL THEN 1 ELSE 0 END AS has_sleep,
    CASE WHEN steps IS NOT NULL THEN 1 ELSE 0 END AS has_activity,
    CASE WHEN resting_heart_rate IS NOT NULL THEN 1 ELSE 0 END AS has_heart_rate,
    CASE WHEN weight_kg IS NOT NULL THEN 1 ELSE 0 END AS has_weight
FROM core.fct_daily_health
WHERE date >= CURRENT_DATE - INTERVAL '30 days';
```

---

## 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成 |
| 2.0.0 | 2025-12-01 | マイグレーションと詳細設計を統合、staging/core/marts層設計を追加、LLM分析設計を追加 |

---

**ドキュメント終了**
