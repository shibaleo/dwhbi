---
title: 003 長期目標配分ロジック
description: 長期目標を day_type ごとに日次 target に配分する仕組み
---

# 長期目標配分ロジック

## 概要

月間・年間などの長期目標を、day_type（Work/Leisure/Education等）ごとに日次 target に配分する。

## 目的

- 長期目標を日々の行動に落とし込む
- day_type に応じた現実的な配分を行う
- 進捗に応じて残り日数で再配分する

## 入力

- `mst_time_long_term_targets`: 長期目標（新規追加予定）
- `dim_day_types`: 日タイプ情報

## 出力

- `fct_time_daily_target`: 日次目標（JSONB 形式）

## 長期目標テーブル設計（案）

```csv
# mst_time_long_term_targets
id,name,time_category_personal,scope_start,scope_end,target_total_min,priority
1,edu_jan,Education,2025-01-01,2025-01-31,6000,high
2,exercise_q1,Exercise,2025-01-01,2025-03-31,3000,medium
```

## 配分ルールテーブル設計（案）

```csv
# mst_time_target_allocation_rules
id,long_term_target_id,day_type,weight
1,1,Education,8    # Education日は8時間分
2,1,Work,1         # Work日は1時間分
3,1,Leisure,2      # Leisure日は2時間分
4,1,Rest,0         # Rest日は0時間
```

## 配分アルゴリズム

### Step 1: 期間内の day_type 別日数をカウント

```sql
SELECT
  day_type,
  COUNT(*) AS day_count
FROM dim_day_types
WHERE date_day BETWEEN '2025-01-01' AND '2025-01-31'
GROUP BY day_type
```

結果例:
| day_type | day_count |
|----------|-----------|
| Work | 15 |
| Education | 8 |
| Leisure | 6 |
| Rest | 2 |

### Step 2: 重み付き配分計算

```sql
WITH weighted AS (
  SELECT
    r.day_type,
    d.day_count,
    r.weight,
    d.day_count * r.weight AS weighted_days
  FROM mst_time_target_allocation_rules r
  JOIN day_counts d ON r.day_type = d.day_type
),
total AS (
  SELECT SUM(weighted_days) AS total_weighted_days FROM weighted
)
SELECT
  w.day_type,
  w.day_count,
  w.weight,
  ROUND(6000.0 * w.weighted_days / t.total_weighted_days) AS allocated_min,
  ROUND(6000.0 * w.weighted_days / t.total_weighted_days / w.day_count) AS daily_min
FROM weighted w, total t
```

結果例（月間100時間 = 6000分）:
| day_type | day_count | weight | allocated_min | daily_min |
|----------|-----------|--------|---------------|-----------|
| Education | 8 | 8 | 4267 | 533 (≈9時間) |
| Leisure | 6 | 2 | 800 | 133 (≈2時間) |
| Work | 15 | 1 | 1000 | 67 (≈1時間) |
| Rest | 2 | 0 | 0 | 0 |

### Step 3: 日次 target 生成

```sql
INSERT INTO fct_time_daily_target (date_day, data)
SELECT
  d.date_day,
  jsonb_build_object(
    'target', jsonb_build_object('Education', daily_allocation.daily_min),
    'direction', jsonb_build_object('Education', 'more'),
    'meta', jsonb_build_object(
      'valid_from', CURRENT_DATE,
      'scope_start', '2025-01-01',
      'scope_end', '2025-01-31',
      'source', 'long_term_breakdown'
    )
  )
FROM dim_day_types d
JOIN daily_allocation ON d.day_type = daily_allocation.day_type
WHERE d.date_day BETWEEN '2025-01-01' AND '2025-01-31'
```

## 進捗連動再配分（将来）

残り日数に応じて動的に再配分:

```sql
-- 残り必要時間 = 目標 - 実績
-- 残り日数で再配分
SELECT
  (target_total_min - actual_total_min) / remaining_days AS adjusted_daily_min
```

## 実装ステータス

- [ ] mst_time_long_term_targets テーブル設計
- [ ] mst_time_target_allocation_rules テーブル設計
- [ ] 配分計算ロジック
- [ ] 日次 target 生成
- [ ] 進捗連動再配分

## 関連ドキュメント

- [131 ADR-003 フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop)
- [131 ADR-004 day_type設計](/100-development/130-design/131-decisions/adr_004-day-type-design)
