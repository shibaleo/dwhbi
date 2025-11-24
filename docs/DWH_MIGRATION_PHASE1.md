# DWH移行 Phase 1: rawスキーマへの移行

## 概要

既存の各サービス専用スキーマ（toggl, fitbit, tanita, zaim, gcalendar, notion）から、
統一された`raw`スキーマへデータを移行し、write_db.tsを書き換えました。

## 完了した作業

### 1. マイグレーションSQL作成・実行

**ファイル:** `supabase/migrations/20251124130000_migrate_to_raw_schema.sql`

- rawスキーマに22テーブルを作成
- 既存データをコピー
- インデックス・RLS・権限設定を適用

### 2. write_db.ts の書き換え

| サービス | 変更前スキーマ | 変更後スキーマ | テーブル名変更例 |
|----------|---------------|---------------|-----------------|
| toggl | toggl | raw | entries → toggl_entries |
| fitbit | fitbit | raw | sleep → fitbit_sleep |
| tanita | tanita | raw | body_composition → tanita_body_composition |
| zaim | zaim | raw (データ), zaim (sync_log) | transactions → zaim_transactions |
| gcalendar | gcalendar | raw | events → gcalendar_events |
| notion | notion | raw (デフォルト) | TB__METADATAで指定 |

### 3. sync_daily.ts の修正

- **zaim/sync_daily.ts**: `createZaimDbClient()`（raw用）と`createZaimSyncLogClient()`（sync_log用）を分離

### 4. fetch_config.ts の修正

- **notion/fetch_config.ts**: `supabase_schema`のデフォルト値を「notion」から「raw」に変更

### 5. 変更されていないファイル

以下は元のスキーマを引き続き使用（tokens, sync_log等の運用系テーブル用）:
- `fitbit/auth.ts` - fitbit.tokens を使用
- `tanita/auth.ts` - tanita.tokens を使用
- `zaim/write_db.ts` - zaim.sync_log を使用（startSyncLog, completeSyncLog）

## テーブル名対応表

### Toggl
| 旧テーブル名 | 新テーブル名 |
|-------------|-------------|
| toggl.clients | raw.toggl_clients |
| toggl.projects | raw.toggl_projects |
| toggl.tags | raw.toggl_tags |
| toggl.entries | raw.toggl_entries |

### Fitbit
| 旧テーブル名 | 新テーブル名 |
|-------------|-------------|
| fitbit.activity_daily | raw.fitbit_activity_daily |
| fitbit.sleep | raw.fitbit_sleep |
| fitbit.heart_rate_daily | raw.fitbit_heart_rate_daily |
| fitbit.hrv_daily | raw.fitbit_hrv_daily |
| fitbit.spo2_daily | raw.fitbit_spo2_daily |
| fitbit.breathing_rate_daily | raw.fitbit_breathing_rate_daily |
| fitbit.cardio_score_daily | raw.fitbit_cardio_score_daily |
| fitbit.temperature_skin_daily | raw.fitbit_temperature_skin_daily |

### Tanita
| 旧テーブル名 | 新テーブル名 |
|-------------|-------------|
| tanita.body_composition | raw.tanita_body_composition |
| tanita.blood_pressure | raw.tanita_blood_pressure |
| tanita.steps | raw.tanita_steps |

### Zaim
| 旧テーブル名 | 新テーブル名 |
|-------------|-------------|
| zaim.categories | raw.zaim_categories |
| zaim.genres | raw.zaim_genres |
| zaim.accounts | raw.zaim_accounts |
| zaim.transactions | raw.zaim_transactions |

### GCalendar
| 旧テーブル名 | 新テーブル名 |
|-------------|-------------|
| gcalendar.events | raw.gcalendar_events |

### Notion
| 旧テーブル名 | 新テーブル名 |
|-------------|-------------|
| notion.gcal_mapping | raw.notion_gcal_mapping |
| notion.sauna | raw.notion_sauna |
| notion.addiction | raw.notion_addiction |

## 運用系テーブル（移行対象外）

以下のテーブルは元のスキーマに残ります:
- `fitbit.tokens` - OAuth2.0トークン管理
- `tanita.tokens` - OAuth2.0トークン管理  
- `zaim.sync_log` - 同期履歴ログ

## 次のステップ (Phase 2以降)

1. **互換性ビューの作成** - 旧スキーマから新スキーマを参照するビュー
2. **旧テーブルの削除** - 動作確認後に旧データテーブルを削除
3. **auth専用スキーマの作成** - tokensテーブルを統合
4. **staging/marts層の構築** - DWH 3層アーキテクチャの完成

## テスト方法

```bash
# 個別サービスの同期テスト
deno run --allow-env --allow-net --allow-read src/services/toggl/sync_daily.ts
deno run --allow-env --allow-net --allow-read src/services/fitbit/sync_daily.ts
deno run --allow-env --allow-net --allow-read src/services/tanita/sync_daily.ts
deno run --allow-env --allow-net --allow-read src/services/zaim/sync_daily.ts
deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_daily.ts
deno run --allow-env --allow-net --allow-read src/services/notion/sync_daily.ts

# 全サービス一括同期
deno run --allow-env --allow-net --allow-read src/sync_all.ts
```

## 注意事項

- Notionサービスは`TB__METADATA`の`supabase_schema`列でスキーマを指定
- 現在のTB__METADATAが「notion」を指定している場合は「raw」に更新が必要
