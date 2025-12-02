---
title: DWH 4層アーキテクチャ
---


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

| 層 | 役割 | サービス名 | 形式 | 実装 |
|----|------|-----------|------|:----:|
| raw | APIレスポンスをそのまま保存 | あり | テーブル | ✅ |
| staging | 型変換、列名正規化、TZ変換 | あり | ビュー | ⏳ |
| core | 複数サービスの統合 | **なし** | ビュー | ⏳ |
| marts | 分析・集計、ドメイン別 | なし | ビュー | ⏳ |

## 命名規則

| 層 | プレフィックス | 例 |
|----|---------------|----|
| raw | `{service}_{entity}` | toggl_entries, fitbit_sleep |
| staging | `stg_{service}__{entity}` | stg_toggl__entries |
| core | `fct_` / `dim_` | fct_time_entries, dim_projects |
| marts | `agg_` / ドメイン名 | agg_daily_health |

## サービス非依存の設計

core層以降ではサービス名が消える：

- 将来Togglから別サービスに移行しても、core/marts層は変更不要
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

### 支出管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.zaim_categories` | (user_id, id) | カテゴリ |
| `raw.zaim_genres` | (user_id, id) | ジャンル |
| `raw.zaim_accounts` | (user_id, id) | 口座 |
| `raw.zaim_transactions` | (user_id, zaim_id) | 取引 |

### 健康管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.fitbit_sleep` | log_id | 睡眠ログ |
| `raw.fitbit_heart_rate_daily` | date | 日次心拍 |
| `raw.fitbit_hrv_daily` | date | 日次HRV |
| `raw.fitbit_activity_daily` | date | 日次活動 |
| `raw.fitbit_spo2_daily` | date | 日次SpO2 |
| `raw.tanita_body_composition` | measured_at | 体組成 |
| `raw.tanita_blood_pressure` | measured_at | 血圧 |

### タスク管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.trello_boards` | id | ボード |
| `raw.trello_lists` | id | リスト |
| `raw.trello_labels` | id | ラベル |
| `raw.trello_cards` | id | カード |
| `raw.ticktick_projects` | id | プロジェクト |
| `raw.ticktick_tasks` | id | タスク |
| `raw.ticktick_habits` | id | 習慣 |

### マスタ管理
| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.airtable_records` | (base_id, table_id, id) | レコード |

## 関連ドキュメント

- [テーブル定義書（詳細）](../database/table_design.md)
- [認証・セキュリティ設計](security.md)
