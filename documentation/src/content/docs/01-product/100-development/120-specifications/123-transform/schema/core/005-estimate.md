---
title: 005 推定値（estimate）
description: estimate（推定）の計算方式設計
---

# 推定値（estimate）

## 概要

ADR-003で定義した4 Information（actual/estimate/target/plan）のうち、estimateの実装仕様。

estimateは「起こりうる」状態を表す客観的・未確定の情報であり、actualを分析して導出される予測値。

## 計算式

```
estimate = actual + plan（残り）
```

より詳細には:

```
estimate = actual（過去〜現在） + plan（現在〜未来）
```

これは `fct_time_records_unified` の設計と一致する（CURRENT_TIMESTAMP境界でactual/planを統合）。

## ストレージ形式

JSONB で非正規化して保存し、ビューで正規化する。

### テーブル構造

```sql
-- core.fct_time_daily_estimate
CREATE TABLE core.fct_time_daily_estimate (
  date_day DATE NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (date_day, (data->'meta'->>'calculated_at')::timestamp)
);
```

### JSONB 形式

```json
{
  "estimate": {
    "Sleep": 420,
    "Work": 480,
    "Education": 180,
    "Leisure": 60
  },
  "meta": {
    "calculated_at": "2025-12-07T15:00:00Z",
    "calculation_method": "actual_plus_plan"
  }
}
```

- `estimate`: カテゴリ名 → 推定時間（分）のマップ
- `meta`: メタ情報（計算時点、計算方法）

※ プロパティ名は `mst_time_personal_categories.name` に一致させる

## 正規化ビュー

```sql
-- core.v_time_daily_estimate
SELECT
  date_day,
  key AS time_category_personal,
  value::integer AS duration_min,
  (data->'meta'->>'calculated_at')::timestamp AS calculated_at,
  data->'meta'->>'calculation_method' AS calculation_method
FROM core.fct_time_daily_estimate,
LATERAL jsonb_each_text(data->'estimate')
```

### 正規化後の列構成

| 列名 | 型 | 説明 |
|------|-----|------|
| date_day | date | 対象日 |
| time_category_personal | text | カテゴリ |
| duration_min | integer | 推定時間（分） |
| calculated_at | timestamp | 計算時点 |
| calculation_method | text | 計算アルゴリズム識別子 |

※ `day_type` は `dim_day_types` から JOIN で取得する

## 履歴管理

estimateの時間変化を分析するため、スナップショット形式で履歴を保持する。

- `calculated_at`: 推定値の計算時点
- 同一 date_day に対して複数のスナップショットが存在しうる
- 過去の予測精度を検証するために使用（例：1週間前の予測と実績の比較）

## 集計レベル

estimateは**集計形式**で提供する。

| 集計単位 | ビュー名（想定） | 説明 |
|----------|----------------|------|
| 日次 | fct_time_daily_estimate | 日 × カテゴリ → 推定時間 |
| 週次 | fct_time_weekly_estimate | 週 × カテゴリ → 推定時間 |
| 月次 | fct_time_monthly_estimate | 月 × カテゴリ → 推定時間 |

## 実装場所

| レイヤー | 内容 |
|----------|------|
| core | `fct_time_records_unified`（レコード形式） |
| core | `fct_time_daily_estimate`（JSONB形式） |
| core | `v_time_daily_estimate`（正規化ビュー） |

## 計算例

```sql
-- marts.estimate_daily
SELECT
  record_date,
  time_category_personal,
  SUM(duration_seconds) / 60.0 AS estimate_min
FROM core.fct_time_records_unified
GROUP BY record_date, time_category_personal
```

## martsでのKPI計算（想定）

```sql
-- marts.kpi_daily_forecast
SELECT
  d.date_day,
  d.day_type,
  cat.name AS category,
  -- 4 Information
  COALESCE(a.actual_min, 0) AS actual_min,
  COALESCE(e.estimate_min, 0) AS estimate_min,
  COALESCE(t.target_min, 0) AS target_min,
  COALESCE(p.plan_min, 0) AS plan_min,
  -- KPI
  ROUND(a.actual_min / NULLIF(t.target_min, 0) * 100, 1) AS achievement_rate,
  ROUND(e.estimate_min / NULLIF(t.target_min, 0) * 100, 1) AS estimated_achievement_rate,
  e.estimate_min - t.target_min AS variance_from_target,
  a.actual_min - p.plan_min AS plan_variance
FROM dim_day_types d
CROSS JOIN mst_time_personal_categories cat
LEFT JOIN actual_daily a ON ...
LEFT JOIN estimate_daily e ON ...
LEFT JOIN target_daily t ON ...
LEFT JOIN plan_daily p ON ...
```

## 未実装事項

### actual → estimate 計算ロジック

現在の estimate は単純な「actual + plan残り」だが、以下の拡張が必要:

1. **移動平均**: 直近N日の傾向から予測
2. **曜日パターン**: 曜日別の傾向を考慮
3. **季節性**: 月別・四半期別の傾向
4. **機械学習**: 過去データからの予測モデル

**実装方針（案）**:
- `fct_time_records_actual` を集計して日別カテゴリ別の実績を算出
- 過去N日の移動平均を計算
- 曜日別の傾向を加味してスケーリング
- 結果を `fct_time_daily_estimate` に JSONB 形式で保存

## 関連ドキュメント

- [131 ADR-003 フィードバックループ](/01-product/100-development/130-design/131-decisions/adr_003-feedback-loop) - 4 Information概念
- [123 目標管理（target）](/01-product/100-development/120-specifications/123-transform/schema/core/004-target) - 目標管理
- [123 統合時間ビュー](/01-product/100-development/120-specifications/123-transform/schema/core/003-time-records-unified) - actual/plan統合
