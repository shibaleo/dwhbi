---
title: データベーススキーマ設計
description: テーブル定義とスキーマ設計
---

# データベーススキーマ設計

## スキーマ一覧

| スキーマ | 役割 | 形式 | 実装状況 |
|---------|------|------|---------|
| `raw` | 外部APIからの生データ | テーブル | 実装済み |
| `seeds` | マスタ・マッピング | dbt seeds | 未実装 |
| `staging` | クリーニング・正規化 | ビュー | 一部実装（Toggl, Google Calendar） |
| `core` | サービス統合 | ビュー | 未実装 |
| `marts` | 分析集計・LLM向け | ビュー | 未実装 |

## seeds スキーマ（dbt seeds）

**dbt seedsがDWHの分析軸を定義する中核**である。

詳細は [131 ADR-002 分析軸マスタ設計](/100-development/130-design/131-decisions/adr_002-ref-schema-design) を参照。

### dbt seedsの役割

```
seeds (分析軸の定義・変換ルール)
├── mst_* : ドメインの分析軸を定義（サービス非依存）
└── map_* : サービス固有値 → 分析軸への変換ルール

staging → core への変換時に seeds.map_* を適用
```

### マスタテーブル（サービス非依存）

| テーブル | 用途 |
|---------|------|
| `seeds.mst_time_social_categories` | 時間social分類（対外的分類） |
| `seeds.mst_time_personal_categories` | 時間personal分類（内省的分類） |

### マッピングテーブル（サービス依存）

| テーブル | 用途 |
|---------|------|
| `seeds.map_toggl_client_to_time_social` | Toggl client → social |
| `seeds.map_toggl_color_to_time_personal` | Toggl色 → personal（色名・HEX含む） |
| `seeds.map_gcal_desc_to_time_social` | Calendar description → social |
| `seeds.map_gcal_color_to_time_personal` | Calendar色 → personal（色名・HEX含む） |

### seeds ファイル構成

```
dbt/seeds/
├── mst_time_social_categories.csv
├── mst_time_personal_categories.csv
├── map_toggl_client_to_time_social.csv
├── map_toggl_color_to_time_personal.csv
├── map_gcal_desc_to_time_social.csv
└── map_gcal_color_to_time_personal.csv
```

配置先: `seeds.*`（seedsスキーマ）

## raw スキーマ

詳細は [121 DWH技術仕様](/100-development/120-specifications/121-overview/dwh-layers) を参照。

- 命名規則: `raw.{service}__{entity}`（ダブルアンダースコア区切り）
- 共通カラム: `id`, `source_id`, `data` (JSONB), `synced_at`, `api_version`
- 実装済み: Toggl Track（9テーブル）、Google Calendar（4テーブル）

## seeds スキーマ テーブル詳細

時間は **social（対外的・共有可能な分類）** と **personal（内省的・個人的分類）** の2軸で分類する。マスタはサービス非依存、マッピングでサービス固有値を変換。詳細は [131 ADR-002](/100-development/130-design/131-decisions/adr_002-ref-schema-design) を参照。

### seeds.mst_time_social_categories

時間social分類のマスタ。サービス非依存。

| カラム | 型 | 説明 |
|--------|-----|------|
| name | TEXT | PK, カテゴリ名（VITALS, WORK等） |
| name_ja | TEXT | 日本語名（生命維持、仕事等） |
| description | TEXT | 説明（英語） |
| sort_order | INTEGER | 表示順 |

**初期データ:** VITALS, HOUSEHOLD, WORK, LEISURE, GROWTH

### seeds.mst_time_personal_categories

時間personal分類のマスタ。サービス非依存。

| カラム | 型 | 説明 |
|--------|-----|------|
| name | TEXT | PK, カテゴリ名（sleep, work等） |
| name_ja | TEXT | 日本語名（睡眠、仕事等） |
| description | TEXT | 説明（英語） |
| sort_order | INTEGER | 表示順 |

**初期データ:** sleep, essential, errand, work, leisure, study, academic, exercise, manage, drift, unused

### seeds.map_toggl_client_to_time_social

Toggl clientから時間socialへのマッピング。

| カラム | 型 | 説明 |
|--------|-----|------|
| toggl_client_name | TEXT | PK, Toggl client名 |
| time_category_social | TEXT | FK → mst_time_social_categories.name |

### seeds.map_toggl_color_to_time_personal

Toggl色から時間personalへのマッピング（API色情報も統合）。

| カラム | 型 | 説明 |
|--------|-----|------|
| toggl_color_hex | TEXT | PK, Toggl色HEX（#0b83d9等） |
| toggl_color_name | TEXT | Toggl色名（Blue等） |
| time_category_personal | TEXT | FK → mst_time_personal_categories.name |

### seeds.map_gcal_desc_to_time_social

Calendar descriptionから時間socialへのマッピング。

| カラム | 型 | 説明 |
|--------|-----|------|
| gcal_description_first_line | TEXT | PK, description 1行目 |
| time_category_social | TEXT | FK → mst_time_social_categories.name |

### seeds.map_gcal_color_to_time_personal

Calendar色から時間personalへのマッピング（API色情報も統合）。

| カラム | 型 | 説明 |
|--------|-----|------|
| gcal_color_id | TEXT | PK, Calendar API色ID（1〜11） |
| gcal_color_name | TEXT | 色名（Lavender等） |
| gcal_color_hex | TEXT | HEX値（参考用） |
| time_category_personal | TEXT | FK → mst_time_personal_categories.name |

## staging層設計

### 命名規則

```
stg_{service}__{entity}
```

### 実装済みビュー（Toggl Track）

| ビュー | 元テーブル | 主な変換 | 実装状況 |
|--------|----------|---------|:--------:|
| `stg_toggl_track__clients` | raw.toggl_track__clients | JSONB展開 | ✅ |
| `stg_toggl_track__projects` | raw.toggl_track__projects | JSONB展開 | ✅ |
| `stg_toggl_track__tags` | raw.toggl_track__tags | JSONB展開 | ✅ |
| `stg_toggl_track__time_entries` | raw.toggl_track__time_entries | JSONB展開、タグ配列正規化 | ✅ |
| `stg_toggl_track__workspaces` | raw.toggl_track__workspaces | JSONB展開 | ✅ |
| `stg_toggl_track__me` | raw.toggl_track__me | JSONB展開 | ✅ |
| `stg_toggl_track__users` | raw.toggl_track__users | JSONB展開 | ✅ |
| `stg_toggl_track__groups` | raw.toggl_track__groups | JSONB展開 | ✅ |
| `stg_toggl_track__time_entries_report` | raw.toggl_track__time_entries_report | JSONB展開 | ✅ |

### 実装済みビュー（Google Calendar）

| ビュー | 元テーブル | 主な変換 | 実装状況 |
|--------|----------|---------|:--------:|
| `stg_google_calendar__colors` | raw.google_calendar__colors | JSONB展開 | ✅ |
| `stg_google_calendar__calendar_list` | raw.google_calendar__calendar_list | JSONB展開 | ✅ |
| `stg_google_calendar__calendars` | raw.google_calendar__calendars | JSONB展開 | ✅ |
| `stg_google_calendar__events` | raw.google_calendar__events | JSONB展開、duration_ms算出 | ✅ |

### 未実装ビュー

| ビュー | 元テーブル | 主な変換 | 実装状況 |
|--------|----------|---------|:--------:|
| `stg_zaim__transactions` | raw.zaim_transactions | category/genre名の結合 | ⏳ |
| `stg_fitbit__sleep` | raw.fitbit_sleep | levels JSONの展開 | ⏳ |
| `stg_fitbit__daily_health` | 複数Fitbitテーブル | 日次健康指標の統合 | ⏳ |
| `stg_tanita__body_metrics` | raw.tanita_* | 体組成+血圧の統合 | ⏳ |
| `stg_trello__*` | raw.trello_* | 型正規化 | ⏳ |
| `stg_ticktick__*` | raw.ticktick_* | 型正規化 | ⏳ |
| `stg_airtable__*` | raw.airtable_* | 型正規化 | ⏳ |

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
| `fct_time_actual` | stg_toggl_track__* | 時間記録（実績） |
| `fct_time_planned` | stg_google_calendar__* | 予定 |
| `fct_transactions` | stg_zaim__transactions | 支出/収入 |
| `fct_sleep_logs` | stg_fitbit__sleep | 睡眠記録 |
| `fct_daily_health` | stg_fitbit__*, stg_tanita__* | 日次健康指標 |
| `dim_date` | - | 日付ディメンション |
| `dim_time_social_categories` | seeds.mst_time_social_categories | 時間social |
| `dim_time_personal_categories` | seeds.mst_time_personal_categories | 時間personal |

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
| `agg_daily_time` | 日次 | 時間 | 作業時間サマリー |
| `agg_weekly_time` | 週次 | 時間 | 週次振り返り |
| `agg_monthly_expense` | 月次 | 支出 | 月次支出集計 |
| `plan_vs_actual_daily` | 日次 | 時間 | 予実比較 |

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-12-01 | 初版作成 |
| 2025-12-03 | Trello, TickTick, Airtable テーブル追加 |
| 2025-12-04 | staging層実装状況を更新（Togglのみ完了） |
| 2025-12-05 | refスキーマ追加、Google Calendar staging完了、core層設計更新 |
| 2025-12-05 | raw層をJSONB形式に更新、refスキーマ詳細追加、staging層更新 |
| 2025-12-05 | raw層詳細をdwh-layers.mdに統合、レガシーテーブル詳細削除 |
| 2025-12-05 | 色テーブルをseedsに移行、map_gcalendar_time_categoriesにリネーム |
| 2025-12-06 | マスタ/マッピング分離設計に変更（サービス非依存化） |
| 2025-12-06 | dbt seeds方式に変更、seedsスキーマに統一、API色情報をmapに統合 |
| 2025-12-06 | seeds実装完了: 6テーブル（mst_*×2, map_*×4）、dbt seed/test通過 |
