---
title: データベーススキーマ設計
description: テーブル定義とスキーマ設計
---

# データベーススキーマ設計

## スキーマ一覧

| スキーマ | 役割 | 形式 | 実装状況 |
|---------|------|------|---------|
| `raw` | 外部APIからの生データ | テーブル | 実装済み |
| `staging` | クリーニング・正規化 | ビュー | 未実装 |
| `core` | サービス統合 | ビュー | 未実装 |
| `marts` | 分析集計・LLM向け | ビュー | 未実装 |

## raw スキーマ テーブル一覧

| テーブル | 主キー | データソース | 実装状況 |
|---------|--------|------------|---------|
| `raw.toggl_clients` | id | Toggl Track | 実装済み |
| `raw.toggl_projects` | id | Toggl Track | 実装済み |
| `raw.toggl_tags` | id | Toggl Track | 実装済み |
| `raw.toggl_entries` | id | Toggl Track | 実装済み |
| `raw.gcalendar_events` | id | Google Calendar | 実装済み |
| `raw.zaim_categories` | (zaim_user_id, id) | Zaim | 実装済み |
| `raw.zaim_genres` | (zaim_user_id, id) | Zaim | 実装済み |
| `raw.zaim_accounts` | (zaim_user_id, id) | Zaim | 実装済み |
| `raw.zaim_transactions` | (zaim_user_id, zaim_id) | Zaim | 実装済み |
| `raw.fitbit_sleep` | log_id | Fitbit | 実装済み |
| `raw.fitbit_heart_rate_daily` | date | Fitbit | 実装済み |
| `raw.fitbit_hrv_daily` | date | Fitbit | 実装済み |
| `raw.fitbit_activity_daily` | date | Fitbit | 実装済み |
| `raw.fitbit_spo2_daily` | date | Fitbit | 実装済み |
| `raw.fitbit_breathing_rate_daily` | date | Fitbit | 実装済み |
| `raw.fitbit_cardio_score_daily` | date | Fitbit | 実装済み |
| `raw.fitbit_temperature_skin_daily` | date | Fitbit | 実装済み |
| `raw.tanita_body_composition` | measured_at | Tanita Health Planet | 実装済み |
| `raw.tanita_blood_pressure` | measured_at | Tanita Health Planet | 実装済み |
| `raw.trello_boards` | id | Trello | 実装済み |
| `raw.trello_lists` | id | Trello | 実装済み |
| `raw.trello_cards` | id | Trello | 実装済み |
| `raw.trello_labels` | id | Trello | 実装済み |
| `raw.trello_actions` | id | Trello | 実装済み |
| `raw.trello_checklists` | id | Trello | 実装済み |
| `raw.trello_checkitems` | id | Trello | 実装済み |
| `raw.ticktick_projects` | id | TickTick | 実装済み |
| `raw.ticktick_tasks` | id | TickTick | 実装済み |
| `raw.ticktick_completed_tasks` | id | TickTick | 実装済み |
| `raw.airtable_bases` | id | Airtable | 実装済み |
| `raw.airtable_tables` | id | Airtable | 実装済み |
| `raw.airtable_records` | id | Airtable | 実装済み |

## Toggl Track テーブル

### raw.toggl_clients

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| name | TEXT | NO | クライアント名 |
| is_archived | BOOLEAN | YES | アーカイブ済みか |
| created_at | TIMESTAMPTZ | NO | 作成日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.toggl_projects

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| client_id | BIGINT | YES | FK → toggl_clients.id |
| name | TEXT | NO | プロジェクト名 |
| color | TEXT | YES | カラーコード |
| is_private | BOOLEAN | YES | プライベートか |
| is_active | BOOLEAN | YES | アクティブか |
| is_billable | BOOLEAN | YES | 課金対象か |
| created_at | TIMESTAMPTZ | NO | 作成日時 |
| archived_at | TIMESTAMPTZ | YES | アーカイブ日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.toggl_tags

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| name | TEXT | NO | タグ名 |
| created_at | TIMESTAMPTZ | NO | 作成日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.toggl_entries

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | BIGINT | NO | PK |
| workspace_id | BIGINT | NO | ワークスペースID |
| project_id | BIGINT | YES | FK → toggl_projects.id |
| task_id | BIGINT | YES | タスクID |
| user_id | BIGINT | YES | ユーザーID |
| description | TEXT | YES | 説明 |
| start | TIMESTAMPTZ | NO | 開始時刻 |
| end | TIMESTAMPTZ | NO | 終了時刻 |
| duration_ms | BIGINT | NO | 期間ミリ秒 |
| is_billable | BOOLEAN | YES | 課金対象か |
| tags | TEXT[] | YES | タグ配列 |
| updated_at | TIMESTAMPTZ | YES | 更新日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## Google Calendar テーブル

### raw.gcalendar_events

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | TEXT | NO | PK |
| calendar_id | TEXT | NO | カレンダーID |
| summary | TEXT | YES | イベント名 |
| description | TEXT | YES | イベント詳細 |
| start_time | TIMESTAMPTZ | NO | 開始日時 |
| end_time | TIMESTAMPTZ | NO | 終了日時 |
| duration_ms | BIGINT | - | 期間ミリ秒（自動計算） |
| is_all_day | BOOLEAN | YES | 終日イベントフラグ |
| color_id | TEXT | YES | カラーID |
| status | TEXT | YES | ステータス |
| recurring_event_id | TEXT | YES | 繰り返しイベントの親ID |
| etag | TEXT | YES | 変更検出用ETag |
| updated | TIMESTAMPTZ | YES | イベント更新日時 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## Zaim テーブル

### raw.zaim_categories

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | INTEGER | NO | 複合PK |
| zaim_user_id | BIGINT | NO | 複合PK |
| name | VARCHAR | NO | カテゴリ名 |
| sort_order | INTEGER | YES | 表示順 |
| mode | VARCHAR | YES | "payment" or "income" |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.zaim_genres

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | INTEGER | NO | 複合PK |
| zaim_user_id | BIGINT | NO | 複合PK |
| category_id | INTEGER | NO | FK → zaim_categories.id |
| name | VARCHAR | NO | ジャンル名 |
| sort_order | INTEGER | YES | 表示順 |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.zaim_accounts

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | INTEGER | NO | 複合PK |
| zaim_user_id | BIGINT | NO | 複合PK |
| name | VARCHAR | NO | 口座名 |
| sort_order | INTEGER | YES | 表示順 |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.zaim_transactions

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| zaim_user_id | BIGINT | NO | 複合PK |
| zaim_id | BIGINT | NO | 複合PK |
| transaction_type | VARCHAR | NO | "payment", "income", "transfer" |
| amount | INTEGER | NO | 金額 |
| date | DATE | NO | 取引日 |
| created_at | TIMESTAMPTZ | NO | 作成日時（UTC） |
| modified_at | TIMESTAMPTZ | YES | 更新日時（UTC） |
| category_id | INTEGER | YES | FK |
| genre_id | INTEGER | YES | FK |
| from_account_id | INTEGER | YES | FK（振替元） |
| to_account_id | INTEGER | YES | FK（振替先） |
| place | TEXT | YES | 店舗・場所 |
| name | TEXT | YES | 品目名 |
| comment | TEXT | YES | コメント |
| is_active | BOOLEAN | YES | アクティブか |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## Fitbit テーブル

### raw.fitbit_sleep

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| date | DATE | NO | 睡眠日 |
| start_time | TIMESTAMPTZ | NO | 開始時刻（UTC） |
| end_time | TIMESTAMPTZ | NO | 終了時刻（UTC） |
| duration_ms | INTEGER | YES | 期間ミリ秒 |
| efficiency | INTEGER | YES | 睡眠効率（%） |
| is_main_sleep | BOOLEAN | YES | メイン睡眠か |
| minutes_asleep | INTEGER | YES | 睡眠時間（分） |
| minutes_awake | INTEGER | YES | 覚醒時間（分） |
| time_in_bed | INTEGER | YES | 就床時間（分） |
| sleep_type | TEXT | YES | "stages" or "classic" |
| levels | JSONB | YES | 睡眠段階詳細 |
| log_id | BIGINT | NO | UNIQUE |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_heart_rate_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| date | DATE | NO | UNIQUE |
| resting_heart_rate | INTEGER | YES | 安静時心拍数 |
| heart_rate_zones | JSONB | YES | 心拍ゾーン配列 |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_hrv_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| date | DATE | NO | UNIQUE |
| daily_rmssd | NUMERIC | YES | 日次RMSSD（ms） |
| deep_rmssd | NUMERIC | YES | 深睡眠時RMSSD |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_activity_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| date | DATE | NO | UNIQUE |
| steps | INTEGER | YES | 歩数 |
| distance_km | NUMERIC | YES | 移動距離（km） |
| floors | INTEGER | YES | 階数 |
| calories_total | INTEGER | YES | 総消費カロリー |
| calories_bmr | INTEGER | YES | 基礎代謝カロリー |
| calories_activity | INTEGER | YES | 活動カロリー |
| sedentary_minutes | INTEGER | YES | 座位時間（分） |
| lightly_active_minutes | INTEGER | YES | 軽活動時間（分） |
| fairly_active_minutes | INTEGER | YES | 中活動時間（分） |
| very_active_minutes | INTEGER | YES | 高活動時間（分） |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.fitbit_spo2_daily

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| date | DATE | NO | UNIQUE |
| avg_spo2 | NUMERIC | YES | 平均SpO2（%） |
| min_spo2 | NUMERIC | YES | 最小SpO2（%） |
| max_spo2 | NUMERIC | YES | 最大SpO2（%） |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### その他 Fitbit テーブル

- `raw.fitbit_breathing_rate_daily` - 呼吸数
- `raw.fitbit_cardio_score_daily` - VO2Max
- `raw.fitbit_temperature_skin_daily` - 皮膚温度

## Tanita テーブル

### raw.tanita_body_composition

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| measured_at | TIMESTAMPTZ | NO | UNIQUE, 測定日時（UTC） |
| weight | NUMERIC | YES | 体重（kg） |
| body_fat_percent | NUMERIC | YES | 体脂肪率（%） |
| model | TEXT | YES | 測定機器モデル |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

### raw.tanita_blood_pressure

| カラム | 型 | NULL | 説明 |
|--------|-----|------|------|
| id | UUID | NO | PK |
| measured_at | TIMESTAMPTZ | NO | UNIQUE, 測定日時（UTC） |
| systolic | INTEGER | YES | 最高血圧（mmHg） |
| diastolic | INTEGER | YES | 最低血圧（mmHg） |
| pulse | INTEGER | YES | 脈拍（bpm） |
| model | TEXT | YES | 測定機器モデル |
| synced_at | TIMESTAMPTZ | YES | 同期日時 |

## staging層設計（未実装）

### 命名規則

```
stg_{service}__{entity}
```

### 予定ビュー

| ビュー | 元テーブル | 主な変換 |
|--------|----------|---------|
| `stg_toggl__entries` | raw.toggl_entries | タグ配列の正規化 |
| `stg_gcalendar__events` | raw.gcalendar_events | duration_ms の補完 |
| `stg_zaim__transactions` | raw.zaim_transactions | category/genre名の結合 |
| `stg_fitbit__sleep` | raw.fitbit_sleep | levels JSONの展開 |
| `stg_fitbit__daily_health` | 複数Fitbitテーブル | 日次健康指標の統合 |
| `stg_tanita__body_metrics` | raw.tanita_* | 体組成+血圧の統合 |

## core層設計（未実装）

サービス名を隠蔽し、ビジネスエンティティとして統合する。

### 命名規則

```
fct_{entity}  -- ファクトテーブル（時系列イベント）
dim_{entity}  -- ディメンションテーブル（マスタ）
```

### 予定ビュー

| ビュー | 元staging | 説明 |
|--------|----------|------|
| `fct_time_entries` | stg_toggl__entries | 時間記録（実績） |
| `fct_scheduled_events` | stg_gcalendar__events | 予定 |
| `fct_transactions` | stg_zaim__transactions | 支出/収入 |
| `fct_sleep_logs` | stg_fitbit__sleep | 睡眠記録 |
| `fct_daily_health` | stg_fitbit__*, stg_tanita__* | 日次健康指標 |
| `dim_projects` | stg_toggl__projects | プロジェクトマスタ |
| `dim_categories` | stg_zaim__* | カテゴリマスタ |

## marts層設計（未実装）

分析・集計済みのビューを提供。

### 命名規則

```
agg_{granularity}_{domain}
```

### 予定ビュー

| ビュー | 粒度 | ドメイン | 用途 |
|--------|------|---------|------|
| `agg_daily_health` | 日次 | 健康 | 健康指標サマリー |
| `agg_daily_productivity` | 日次 | 時間 | 作業時間サマリー |
| `agg_weekly_productivity` | 週次 | 時間 | 週次振り返り |
| `agg_monthly_expense` | 月次 | 支出 | 月次支出集計 |
| `plan_vs_actual_daily` | 日次 | 時間 | 予実比較 |

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-12-01 | 初版作成 |
| 2025-12-03 | Trello, TickTick, Airtable テーブル追加 |
