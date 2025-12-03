---
title: DWH 4層アーキテクチャ
description: データウェアハウスの層構造と設計方針
---

# DWH 4層アーキテクチャ

## 層構造

```
┌─────────────────────────────────────────────────────────────────────┐
│ marts.*                                                             │
│   分析・集計ビュー                                                  │
│   agg_daily_health, agg_weekly_productivity                         │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ core.*                                                              │
│   サービス統合（サービス名が消える）                                │
│   fct_time_entries, fct_transactions, dim_categories                │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ staging.*                                                           │
│   クリーニング・正規化済み                                          │
│   stg_toggl__entries, stg_zaim__transactions                        │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ raw.*                                                               │
│   外部APIからの生データ                                             │
│   toggl_entries, zaim_transactions, fitbit_sleep                    │
└─────────────────────────────────────────────────────────────────────┘
```

## 層別設計

| 層 | 役割 | サービス名 | 形式 | 管理方法 |
|----|------|-----------|------|---------|
| raw | APIレスポンスをそのまま保存 | あり | テーブル | マイグレーション |
| staging | 型変換、列名正規化、TZ変換 | あり | ビュー | dbt（サーバー定義） |
| core | 複数サービスの統合 | **なし** | ビュー | ビジュアルエディタ（将来） |
| marts | 分析・集計、ドメイン別 | なし | ビュー | ビジュアルエディタ（将来） |

## rawテーブルのスキーマ設計

### 方針：構造化列 + 生データ保存

FIXIT: rawテーブルのスキーマはAPI仕様に従う。
すべてのrawテーブルは以下の構造に従う：

```sql
CREATE TABLE {service}.{entity} (
  -- 識別子
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  {service}_id BIGINT UNIQUE NOT NULL,  -- サービス側のID

  -- 構造化列（頻繁にクエリする項目）
  date DATE NOT NULL,
  -- ... サービス固有の重要項目

  -- 生データ保存（API変更への耐性）
  raw_response JSONB NOT NULL,

  -- メタデータ
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 設計理由

| 要素 | 目的 |
|------|------|
| 構造化列 | 高速クエリ、型安全、インデックス対応 |
| raw_response | API変更時も生データ保持、後から再パース可能 |
| synced_at | いつ取得したデータか追跡可能 |

## マイグレーション戦略

### 実行タイミング

**初回セットアップ時に、対応済みサービスすべてのテーブルを作成**

```
supabase/migrations/
├── 00001_core_tables.sql       # app_config, allowed_users, sync_logs
├── 00002_toggl_tables.sql      # raw.toggl_*
├── 00003_gcalendar_tables.sql  # raw.gcalendar_*
├── 00004_zaim_tables.sql       # raw.zaim_*
├── :
└── 00010_vault_functions.sql   # Vault操作用の関数
```

### 未使用テーブルについて

- 連携していないサービスのテーブルも作成される
- 空テーブルのストレージコストはほぼゼロ
- PostgreSQLは空テーブルによる性能影響なし
- 全ユーザー共通のスキーマにより、テンプレートとしての堅牢性を確保

## staging層の管理

### 方針

- **サーバー側で定義**: 全ユーザー共通のクレンジングロジック
- **dbtで実装**: SQL変換の標準ツール


### 責務

| 処理 | 例 |
|------|---|
| 型変換 | 文字列→タイムスタンプ |
| 列名正規化 | `startTime` → `start_time` |
| タイムゾーン変換 | JST → UTC |
| NULL処理 | デフォルト値の設定 |
| フィルタリング | 削除済みレコードの除外 |

## 命名規則

| 層 | プレフィックス | 例 |
|----|---------------|----|
| raw | `raw.{service}_{entity}` | raw.toggl_entries, raw.fitbit_sleep_logs |
| staging | `stg_{service}__{entity}` | stg_toggl__entries |
| core | `fct_` / `dim_` | fct_time_entries, dim_projects |
| marts | `agg_` / ドメイン名 | agg_daily_health |

## サービス非依存の設計

core層以降ではサービス名が消える：

- 将来Toggl Trackから別サービスに移行しても、core/marts層は変更不要
- 分析クエリは `fct_time_entries` を参照し、データソースを意識しない
- staging層で新旧サービスを統合するロジックを吸収

## raw層テーブル一覧

### 時間管理

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.toggl_clients` | id | クライアント |
| `raw.toggl_projects` | id | プロジェクト |
| `raw.toggl_tags` | id | タグ |
| `raw.toggl_entries` | id | 時間エントリー |
| `raw.gcalendar_events` | id | カレンダーイベント |

### 家計管理

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.zaim_categories` | id | カテゴリ |
| `raw.zaim_genres` | id | ジャンル |
| `raw.zaim_accounts` | id | 口座 |
| `raw.zaim_transactions` | id | 取引 |

### 健康管理

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.fitbit_sleep_logs` | log_id | 睡眠ログ |
| `raw.fitbit_heart_rate_daily` | date | 日次心拍 |
| `raw.fitbit_hrv_daily` | date | 日次HRV |
| `raw.fitbit_activity_daily` | date | 日次活動 |
| `raw.fitbit_spo2_daily` | date | 日次SpO2 |
| `raw.tanita_body_composition` | measured_at | 体組成 |
| `raw.tanita_blood_pressure` | measured_at | 血圧 |

### プロジェクト管理

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.trello_boards` | id | ボード |
| `raw.trello_lists` | id | リスト |
| `raw.trello_labels` | id | ラベル |
| `raw.trello_cards` | id | カード |

### タスク・習慣管理

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.ticktick_projects` | id | プロジェクト |
| `raw.ticktick_tasks` | id | タスク |
| `raw.ticktick_habits` | id | 習慣 |

