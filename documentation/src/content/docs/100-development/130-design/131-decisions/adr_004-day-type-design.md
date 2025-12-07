---
title: ADR-004 day_type設計
description: plan/actualからday_typeを動的に導出するロジックの設計
---

# ADR-004: day_type設計

## ステータス

採用（2025-12-07）

## コンテキスト

時間分析において、日タイプ（仕事日、休日、勉強日など）で集計を分ける必要がある。「一日平均何時間勉強している？」の回答は、仕事日と休日で大きく異なるため、day_typeごとの分析が必要。

## 決定

day_typeを独立したテーブルとして持たず、**plan（Google Calendar）とactual（Toggl）から動的に導出**する。

## なぜday_typeが必要か

1. **分析の精度向上**: 「一日平均何時間勉強している？」の回答が、仕事日/休日で大きく異なる。平均化すると意味のある分析ができない
2. **目標分配の精度向上**: 長期目標を日次に分解するとき、日タイプごとに適切な配分が必要

## 設計方針の変遷

### 当初案: 明示的なday_typeテーブル

- `mst_day_types`マスタ（workday, off, half）
- `my_calendar`テーブルで各日のday_typeを手動設定
- デフォルトロジック（土日=off、平日=workday）

### 問題点

- 「明日はstudydayにしよう」と設定しつつ、予定には友人との約束 → 矛盾を許容してしまう
- day_typeが「願望」になり、計画との整合性が保証されない

### 採用案: plan/actualからday_typeを導出

**利点:**
- 計画と日タイプが自動的に整合する
- 「明日をstudydayにしたい」なら、予定を調整してEducation時間を確保する必要がある
- day_typeが「事実」になる

**導出の考え方:**
```
plan（Google Calendar）から day_type_planned を導出
actual（Toggl）から day_type_actual を導出
```

**統合ビュー `v_time_unified_plan` を使用:**

過去はactual、未来はplanを使用する統合ビューにハイブリッドロジックを適用することで、全日付のday_typeを統一的に導出できる。

```sql
-- v_time_unified_plan（actual + plan統合）
SELECT date, 'actual' as source, time_category_personal, duration_min
FROM fct_time_actual
WHERE date < CURRENT_DATE
UNION ALL
SELECT date, 'plan' as source, time_category_personal, duration_min
FROM fct_time_planned
WHERE date >= CURRENT_DATE
```

この統合ビューに対してハイブリッドロジックを適用し、`dim_date.day_type`を導出する。

## 採用案: ハイブリッドロジック（閾値 + 最大時間）

段階的に条件分岐で判定し、フォールバックとして最大時間を使用する。

| Step | 条件 | day_type | 理由 |
|:----:|------|----------|------|
| 1 | Work >= 5h | Work | 5時間以上働けば仕事日 |
| 2 | Drift >= 2h | Drift | 2時間以上漂流は警告として可視化 |
| 3 | 上記以外 | eligible内で最大時間 | 残りは支配的なカテゴリで判定 |

**Step 3の対象カテゴリ**（Work, Drift以外の`is_day_type_eligible=true`）:
- Household, Leisure, Education, Learning, Manage

```sql
-- ハイブリッドロジック
WITH daily_hours AS (
  SELECT
    date,
    time_category_personal,
    SUM(duration_hours) as total_hours
  FROM fct_time_actual
  GROUP BY date, time_category_personal
),
eligible_hours AS (
  SELECT dh.*
  FROM daily_hours dh
  JOIN seeds.mst_time_personal_categories cat
    ON dh.time_category_personal = cat.name
  WHERE cat.is_day_type_eligible = true
),
max_eligible AS (
  SELECT
    date,
    time_category_personal,
    ROW_NUMBER() OVER (PARTITION BY date ORDER BY total_hours DESC) as rn
  FROM eligible_hours
)
SELECT
  date,
  CASE
    -- Step 1: Work >= 5h → Work
    WHEN (SELECT total_hours FROM daily_hours WHERE date = d.date AND time_category_personal = 'Work') >= 5
      THEN 'Work'
    -- Step 2: Drift >= 2h → Drift
    WHEN (SELECT total_hours FROM daily_hours WHERE date = d.date AND time_category_personal = 'Drift') >= 2
      THEN 'Drift'
    -- Step 3: eligible内で最大時間
    ELSE (SELECT time_category_personal FROM max_eligible WHERE date = d.date AND rn = 1)
  END as day_type
FROM (SELECT DISTINCT date FROM daily_hours) d;
```

**注**: 閾値（Work: 5h, Drift: 2h）はビジネスロジックとして調整可能。

## day_type判定カテゴリの選定

`mst_time_personal_categories`に`is_day_type_eligible`カラムを追加し、day_type導出に使用するカテゴリを明示する。

| カテゴリ | is_day_type_eligible | 除外理由 |
|---------|:--------------------:|----------|
| Sleep | false | 10時間寝ても「Sleepday」に意味はない。睡眠分析はFitbitで別途行う |
| Essential | false | 食事・入浴・衛生だけで一日が終わることはほとんどない |
| Household | **true** | 引っ越し、大掃除、買い物で一日終わることはある |
| Work | **true** | 勤務日の主要カテゴリ |
| Leisure | **true** | 休日の主要カテゴリ |
| Education | **true** | 勉強日の主要カテゴリ |
| Learning | **true** | 知的探求に費やす日もある |
| Exercise | false | 運動がメインの日はLeisureとしてTogglに記録する運用 |
| Manage | **true** | 振り返りや計画に費やす日もある |
| Drift | **true** | 漂流が多い日は警告として可視化する価値がある |
| Unused | false | 未分類。判定には使用しない |

## day_typeの値域

time_category_personalをそのまま使用（Work, Leisure, Education等）。別途day_type専用のマスタは持たない。

## 結果

- 判定ロジック: ハイブリッドロジック（閾値 + 最大時間）を採用
- 判定カテゴリ: `is_day_type_eligible`カラムで管理
- 値域: time_category_personalをそのまま使用

## 関連

- [ADR-003 時間管理フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop)
- [ADR-002 分析軸マスタ設計](/100-development/130-design/131-decisions/adr_002-ref-schema-design)
