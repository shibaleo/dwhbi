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

### 方針：JSONB単一列 + source_idによるUPSERT

raw層はAPIレスポンスをそのまま保存する。構造化は staging 層で行う。

```sql
CREATE TABLE raw.{service}__{entity} (
  -- 識別子
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL UNIQUE,  -- APIレスポンス内のID（UPSERT用）

  -- 生データ保存
  data JSONB NOT NULL,             -- APIレスポンスそのまま

  -- メタデータ
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  api_version TEXT                 -- 取得時のAPIバージョン（v9, v3等）
);

-- インデックス
CREATE INDEX idx_{service}__{entity}_synced_at ON raw.{service}__{entity} (synced_at);
CREATE INDEX idx_{service}__{entity}_data_gin ON raw.{service}__{entity} USING gin (data);
```

### 命名規則

| 項目 | 規則 | 例 |
|------|------|-----|
| スキーマ | `raw` | `raw.toggl_track__time_entries` |
| テーブル名 | `{service}__{entity}` | `toggl_track__time_entries` |
| サービス名 | snake_case | `toggl_track`, `google_calendar` |
| エンティティ名 | snake_case（複数形） | `time_entries`, `projects` |
| 区切り | ダブルアンダースコア `__` | サービスとエンティティの区切り |

### 設計理由

| 要素 | 目的 |
|------|------|
| JSONB単一列 | API変更への耐性、スキーマ変更不要 |
| source_id | 重複排除・UPSERT用のユニークキー |
| api_version | APIバージョン変更時のデータ追跡 |
| GINインデックス | JSONB内の値検索を高速化 |

### データ取得方針

| API種別 | 用途 | 取得範囲 | 頻度 |
|---------|------|----------|------|
| Track API v9 | 日次同期 | 直近3日分 | 毎日 |
| Reports API v3 | 初期/修復 | 指定期間（最大1年/リクエスト） | 手動 |

**Track API v9** (`/me/time_entries`)
- 日次同期用。直近のエントリーを高速取得
- 実行中エントリー（duration < 0）も取得可能

**Reports API v3** (`/reports/api/v3/.../search/time_entries`)
- 全件取得用。billable_amount等の追加情報あり
- 1リクエストあたり最大1年の制限あり（自動分割対応）
- 無料プラン: 30リクエスト/時間（402エラー時は60分待機）

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
| raw | `raw.{service}__{entity}` | raw.toggl_track__time_entries |
| staging | `staging.stg_{service}__{entity}` | staging.stg_toggl__time_entries |
| core | `core.fct_` / `core.dim_` | core.fct_time_entries, core.dim_projects |
| marts | `marts.agg_` / ドメイン名 | marts.agg_daily_health |

**注意**: raw層はダブルアンダースコア `__` でサービスとエンティティを区切る

## サービス非依存の設計

core層以降ではサービス名が消える：

- 将来Toggl Trackから別サービスに移行しても、core/marts層は変更不要
- 分析クエリは `fct_time_entries` を参照し、データソースを意識しない
- staging層で新旧サービスを統合するロジックを吸収

## raw層テーブル一覧

### 時間管理（Toggl Track）

| テーブル | source_id | API | 説明 |
|---------|-----------|-----|------|
| `raw.toggl_track__time_entries` | entry id | Track v9 | 日次同期用エントリー |
| `raw.toggl_track__time_entries_report` | entry id | Reports v3 | 全件取得用エントリー |
| `raw.toggl_track__projects` | project id | Track v9 | プロジェクト |
| `raw.toggl_track__clients` | client id | Track v9 | クライアント |
| `raw.toggl_track__tags` | tag id | Track v9 | タグ |
| `raw.toggl_track__me` | user id | Track v9 | ユーザープロフィール |
| `raw.toggl_track__workspaces` | workspace id | Track v9 | ワークスペース |
| `raw.toggl_track__users` | user id | Track v9 | ワークスペースメンバー |
| `raw.toggl_track__groups` | group id | Track v9 | ワークスペースグループ |

### 時間管理（Google Calendar）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.google_calendar__events` | event id | カレンダーイベント |

### 家計管理（Zaim）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.zaim__categories` | category id | カテゴリ |
| `raw.zaim__genres` | genre id | ジャンル |
| `raw.zaim__accounts` | account id | 口座 |
| `raw.zaim__transactions` | transaction id | 取引 |

### 健康管理（Fitbit）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.fitbit__sleep_logs` | log id | 睡眠ログ |
| `raw.fitbit__heart_rate_daily` | date | 日次心拍 |
| `raw.fitbit__hrv_daily` | date | 日次HRV |
| `raw.fitbit__activity_daily` | date | 日次活動 |
| `raw.fitbit__spo2_daily` | date | 日次SpO2 |

### 健康管理（Tanita）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.tanita__body_composition` | measured_at | 体組成 |
| `raw.tanita__blood_pressure` | measured_at | 血圧 |

### プロジェクト管理（Trello）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.trello__boards` | board id | ボード |
| `raw.trello__lists` | list id | リスト |
| `raw.trello__labels` | label id | ラベル |
| `raw.trello__cards` | card id | カード |

### タスク・習慣管理（TickTick）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.ticktick__projects` | project id | プロジェクト |
| `raw.ticktick__tasks` | task id | タスク |
| `raw.ticktick__habits` | habit id | 習慣 |

### マスタ管理（Airtable）

| テーブル | source_id | 説明 |
|---------|-----------|------|
| `raw.airtable__records` | record id | レコード |

