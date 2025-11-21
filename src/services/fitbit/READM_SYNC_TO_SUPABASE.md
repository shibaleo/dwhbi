# FitbitデータのSupabase同期

## 概要

FitbitのキャッシュデータをSupabaseへバッチでupsertするプログラムです。

## 機能

### 同期対象データ

1. **体重・体脂肪率・BMI** (`body_metrics_daily`)
2. **睡眠記録** (`sleep_records`)
3. **心拍数** (`heart_rate_daily`)
4. **活動量サマリー** (`activity_summary_daily`)
   - 歩数、距離、カロリー、階数、標高
   - 活動レベル別時間（sedentary, lightly, fairly, very active）
5. **SpO2** (`spo2_daily`)

### 特徴

- ✅ **バッチupsert**: 日付でユニーク制約を利用して重複を自動更新
- ✅ **データ変換**: FitbitのAPIレスポンスをFHIR準拠のSupabaseスキーマに変換
- ✅ **エラーハンドリング**: データがない場合やエラーが発生した場合でも処理を継続
- ✅ **詳細ログ**: 日付ごとのupsert状況をリアルタイム表示
- ✅ **サマリー出力**: 同期完了時に統計情報を表示

## 前提条件

### 1. 環境変数の設定

`.env`ファイルに以下を設定：

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### 2. キャッシュの準備

先に`fetch_fitbit_data.ts`を実行して、`./cache/`ディレクトリにキャッシュを作成しておく必要があります：

```bash
deno run --allow-all fetch_fitbit_data.ts 2025-01-01 2025-01-31
```

## 使い方

### 基本実行（過去7日間）

```bash
deno run --allow-all sync_fitbit_to_supabase.ts
```

### 期間指定

```bash
deno run --allow-all sync_fitbit_to_supabase.ts 2025-01-01 2025-01-31
```

### 実行例

```
📥 キャッシュを読み込んでいます: 2025-01-01 〜 2025-01-31
✅ 31日分のキャッシュを読み込みました

📊 Supabaseへの同期を開始します（31日分）

📅 2025-01-01:
  ✅ body_metrics_daily: 1件 upsert完了
  ✅ sleep_records: 1件 upsert完了
  ✅ heart_rate_daily: 1件 upsert完了
  ✅ activity_summary_daily: 1件 upsert完了
  ✅ spo2_daily: 1件 upsert完了

📅 2025-01-02:
  ⏭️  body_metrics_daily: スキップ（データなし）
  ✅ sleep_records: 2件 upsert完了
  ✅ heart_rate_daily: 1件 upsert完了
  ✅ activity_summary_daily: 1件 upsert完了
  ⏭️  spo2_daily: スキップ（データなし）

...

============================================================
📈 同期完了サマリー:
  体重・体脂肪・BMI: 28件
  睡眠記録: 35件
  心拍数: 31件
  活動量: 31件
  SpO2: 25件
============================================================

✨ 同期が完了しました
```

## データ変換の詳細

### 体重・体脂肪率・BMI

```typescript
{
  date: "2025-01-01",
  weight_kg: 70.5,
  body_fat_percent: 18.2,
  bmi: 23.4,
  source: "fitbit",
  synced_at: "2025-01-01T12:00:00Z"
}
```

- LOINC codes: `29463-7` (体重), `41982-0` (体脂肪率), `39156-5` (BMI)

### 睡眠記録

```typescript
{
  date: "2025-01-01",
  start_time: "2025-01-01T23:30:00Z",
  end_time: "2025-01-02T07:15:00Z",
  total_minutes: 465,
  deep_minutes: 98,
  light_minutes: 245,
  rem_minutes: 92,
  awake_minutes: 30,
  efficiency_percent: 93.5,
  is_main_sleep: true,
  time_in_bed_minutes: 480,
  minutes_to_fall_asleep: 15,
  sleep_type: "stages",
  metadata: { ... }, // 詳細データ
  source: "fitbit",
  synced_at: "2025-01-02T08:00:00Z"
}
```

- LOINC codes: `93832-4` (総睡眠時間), `93831-6` (深い睡眠), `93830-8` (浅い睡眠), `93829-0` (REM睡眠)

### 心拍数

```typescript
{
  date: "2025-01-01",
  resting_heart_rate: 58,
  out_of_range_minutes: 1320,
  fat_burn_minutes: 55,
  cardio_minutes: 25,
  peak_minutes: 10,
  heart_rate_zones: [ ... ], // ゾーン詳細
  source: "fitbit",
  synced_at: "2025-01-01T23:59:00Z"
}
```

- LOINC code: `40443-4` (安静時心拍数)

### 活動量サマリー

```typescript
{
  date: "2025-01-01",
  steps: 8543,
  distance_meters: 6234, // kmをメートルに変換
  calories_burned: 2345,
  floors: 12,
  elevation_meters: 36.5,
  sedentary_minutes: 980,
  lightly_active_minutes: 180,
  fairly_active_minutes: 45,
  very_active_minutes: 35,
  source: "fitbit",
  synced_at: "2025-01-01T23:59:00Z"
}
```

- LOINC codes: `41950-7` (歩数), `41981-2` (消費カロリー)

### SpO2

```typescript
{
  date: "2025-01-01",
  spo2_percent: 96.5,
  spo2_min: 94.0,
  spo2_max: 98.5,
  source: "fitbit",
  synced_at: "2025-01-01T08:00:00Z"
}
```

- LOINC code: `59408-5` (血中酸素飽和度)

## エラーハンドリング

### データがない場合

データがない日は自動的にスキップされます：

```
  ⏭️  body_metrics_daily: スキップ（データなし）
```

### エラーが発生した場合

エラーが発生した場合でも、他のデータの処理は継続します：

```
  ❌ sleep_records: エラー duplicate key value violates unique constraint
```

## スケジュール実行

GitHub Actionsで毎日自動実行する場合：

```yaml
name: Sync Fitbit to Supabase

on:
  schedule:
    - cron: '0 9 * * *' # JST 18:00 (UTC 09:00)
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x
      
      # 1. Fitbitデータ取得
      - name: Fetch Fitbit Data
        env:
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}
        run: deno run --allow-all fetch_fitbit_data.ts
      
      # 2. Supabaseへ同期
      - name: Sync to Supabase
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: deno run --allow-all sync_fitbit_to_supabase.ts
```

## トラブルシューティング

### Q: キャッシュが見つからない

```
❌ エラーが発生しました: 読み込めるキャッシュがありません。
```

**A:** 先に`fetch_fitbit_data.ts`を実行してください。

### Q: Supabase接続エラー

```
❌ Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set
```

**A:** 環境変数が設定されているか確認してください。

### Q: 重複エラーが発生する

```
❌ sleep_records: エラー duplicate key value violates unique constraint
```

**A:** `sleep_records`テーブルは`date`と`start_time`の組み合わせでユニークです。同じ日の同じ開始時刻の睡眠記録は更新されます。

## 開発者向け

### データ変換関数の拡張

新しいデータタイプを追加する場合：

1. `transform関数`を追加
2. `syncFitbitDataToSupabase()`で呼び出し
3. `totalStats`にカウンターを追加

例：

```typescript
function transformNewMetric(date: string, data: FitbitAllScopeData) {
  // データ変換ロジック
  return { ... };
}

// syncFitbitDataToSupabase()内
const newMetric = transformNewMetric(date, data);
await upsertToSupabase("new_metric_table", newMetric, ["date"]);
```

## まとめ

このプログラムは、Fitbitから取得したデータをSupabaseへ効率的に同期するためのツールです。キャッシュ機能と組み合わせることで、APIリクエスト数を最小限に抑えながら、確実にデータをSupabaseに保存できます。