---
title: DWH 4層アーキテクチャ
---

## 層構造

```
┌─────────────────────────────────────────────────────────────────────┐
│ marts.*                                                             │
│   分析・集計ビュー                                                  │
│   agg_daily_health, agg_weekly_productivity                         │
│   【将来】ビジュアルエディタで動的構築                               │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ core.*                                                              │
│   サービス統合（サービス名が消える）                                │
│   fct_time_entries, fct_transactions, dim_categories                │
│   【将来】ビジュアルエディタで動的構築                               │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ staging.*                                                           │
│   クリーニング・正規化済み                                          │
│   stg_toggl__entries, stg_zaim__transactions                        │
│   【dbt】サーバー側で定義・全ユーザー共通                            │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ raw.*                                                               │
│   外部APIからの生データ                                             │
│   toggl_entries, zaim_transactions, fitbit_sleep                    │
│   【マイグレーション】初回セットアップで全テーブル作成               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 層別設計

| 層 | 役割 | サービス名 | 形式 | 管理方法 | 実装 |
|----|------|-----------|------|---------|:----:|
| raw | APIレスポンスをそのまま保存 | あり | テーブル | マイグレーション | ✅ |
| staging | 型変換、列名正規化、TZ変換 | あり | ビュー | dbt（サーバー定義） | ⏳ |
| core | 複数サービスの統合 | **なし** | ビュー | ビジュアルエディタ（将来） | ⏳ |
| marts | 分析・集計、ドメイン別 | なし | ビュー | ビジュアルエディタ（将来） | ⏳ |

---

## rawテーブルのスキーマ設計

### 方針：構造化列 + 生データ保存

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

### 例：fitbit.sleep_logs

```sql
CREATE TABLE fitbit.sleep_logs (
  -- 識別子
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id BIGINT UNIQUE NOT NULL,
  
  -- 構造化列
  date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  efficiency INTEGER,
  
  -- 生データ
  raw_response JSONB NOT NULL,
  
  -- メタデータ
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## マイグレーション戦略

### 実行タイミング

**初回セットアップ時にすべてのテーブルを作成**

```
supabase/migrations/
├── 00001_core_tables.sql       # app_config, allowed_users, sync_logs
├── 00002_toggl_tables.sql      # toggl.*
├── 00003_gcalendar_tables.sql  # gcalendar.*
├── 00004_zaim_tables.sql       # zaim.*
├── 00005_fitbit_tables.sql     # fitbit.*
├── 00006_tanita_tables.sql     # tanita.*
├── 00007_trello_tables.sql     # trello.*
├── 00008_ticktick_tables.sql   # ticktick.*
├── 00009_airtable_tables.sql   # airtable.*
└── 00010_vault_functions.sql   # Vault操作用の関数
```

### 実行方法

```bash
# Supabase CLI
supabase db push

# または Supabase Dashboard の SQL Editor で実行
```

### 未使用テーブルについて

- 連携していないサービスのテーブルも作成される
- 空テーブルのストレージコストはほぼゼロ
- PostgreSQLは空テーブルによる性能影響なし
- 全ユーザー共通のスキーマにより、テンプレートとしての堅牢性を確保

---

## staging層の管理（dbt）

### 方針

- **サーバー側で定義**：全ユーザー共通のクレンジングロジック
- **dbtで実装**：SQL変換の標準ツール
- **ビューとして作成**：ストレージ不要、常に最新データ

### 責務

| 処理 | 例 |
|------|---|
| 型変換 | 文字列→タイムスタンプ |
| 列名正規化 | `startTime` → `start_time` |
| タイムゾーン変換 | UTC → JST |
| NULL処理 | デフォルト値の設定 |
| フィルタリング | 削除済みレコードの除外 |

### 命名規則

```
stg_{service}__{entity}

例:
- stg_toggl__entries
- stg_fitbit__sleep
- stg_zaim__transactions
```

---

## core/marts層の管理（将来：ビジュアルエディタ）

### 方針

- **ユーザーが動的に構築**：分析したい軸はユーザーごとに異なる
- **ビジュアルエディタ**：コード不要でデータフローを設計
- **Phase 4以降で実装**

### 構想

```
┌─────────────────────────────────────────────────────────────┐
│  データフローエディタ                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [stg_fitbit__sleep]──┐                                    │
│                       ├──[結合]──[集計]──[日次サマリー]     │
│  [stg_toggl__entries]─┘     │                              │
│                             │                              │
│  [stg_zaim__transactions]───┴──[フィルタ]──[月次支出]       │
│                                                             │
│  ────────────────────────────────────────────────────────  │
│  プレビュー: SELECT date, sleep_hours, work_hours FROM ...  │
│                                                             │
│  [保存] [実行]                                               │
└─────────────────────────────────────────────────────────────┘
```

### 実現方法（検討中）

| アプローチ | 難易度 | 備考 |
|-----------|:------:|------|
| React Flow → SQL生成 → VIEW作成 | 高 | フルスクラッチ |
| React Flow → dbt models生成 | 中 | dbt CLIが必要 |
| 既存ツール連携（Metabase等） | 低 | 可視化特化、ETLは限定的 |

---

## 命名規則

| 層 | プレフィックス | 例 |
|----|---------------|----|
| raw | `{service}.{entity}` | toggl.entries, fitbit.sleep_logs |
| staging | `stg_{service}__{entity}` | stg_toggl__entries |
| core | `fct_` / `dim_` | fct_time_entries, dim_projects |
| marts | `agg_` / ドメイン名 | agg_daily_health |

---

## サービス非依存の設計

core層以降ではサービス名が消える：

- 将来Togglから別サービスに移行しても、core/marts層は変更不要
- 分析クエリは `fct_time_entries` を参照し、データソースを意識しない
- staging層で新旧サービスを統合するロジックを吸収

---

## raw層テーブル一覧

### 時間管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `toggl.clients` | id | クライアント |
| `toggl.projects` | id | プロジェクト |
| `toggl.tags` | id | タグ |
| `toggl.entries` | id | 時間エントリー |
| `gcalendar.events` | id | カレンダーイベント |

### 家計管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `zaim.categories` | id | カテゴリ |
| `zaim.genres` | id | ジャンル |
| `zaim.accounts` | id | 口座 |
| `zaim.transactions` | id | 取引 |

### 健康管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `fitbit.sleep_logs` | log_id | 睡眠ログ |
| `fitbit.heart_rate_daily` | date | 日次心拍 |
| `fitbit.hrv_daily` | date | 日次HRV |
| `fitbit.activity_daily` | date | 日次活動 |
| `fitbit.spo2_daily` | date | 日次SpO2 |
| `tanita.body_composition` | measured_at | 体組成 |
| `tanita.blood_pressure` | measured_at | 血圧 |

### プロジェクト管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `trello.boards` | id | ボード |
| `trello.lists` | id | リスト |
| `trello.labels` | id | ラベル |
| `trello.cards` | id | カード |

### タスク・習慣管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `ticktick.projects` | id | プロジェクト |
| `ticktick.tasks` | id | タスク |
| `ticktick.habits` | id | 習慣 |

### マスタ管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `airtable.records` | (base_id, table_id, id) | レコード |

---

## 関連ドキュメント

- [テーブル定義書（詳細）](../database/table-design)
- [認証・セキュリティ設計](security)
- [管理ダッシュボード設計](admin-dashboard)

---

*最終更新: 2025-12-02*
