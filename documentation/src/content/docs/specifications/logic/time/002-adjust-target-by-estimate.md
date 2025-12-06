---
title: 002 目標調整ロジック
description: estimate を踏まえて target を plan に反映する仕組み
---

# 目標調整ロジック

## 概要

ADR-003 のフィードバックループにおける「aim」「adjustment」プラクティス。
estimate（推定）を踏まえて target（目標）を設定し、plan（計画）に反映する。

## フロー

```
estimate → (aim) → target → (adjustment) → plan
   ↓                  ↓                      ↓
 "できる"           "したい"               "する"
```

## 目的

- estimate を参照して現実的な target を設定する
- target と現実制約を擦り合わせて plan を調整する
- フィードバックループを回して継続的に改善する

## 入力

- `fct_time_daily_estimate`: 推定値
- `fct_time_daily_target`: 目標値
- `fct_time_records_plan`: 計画（Google Calendar）

## 出力

- ダッシュボード表示用の差分データ
- （将来）plan 提案

## ロジック

### estimate vs target 比較

```sql
-- estimate と target の差分を計算
SELECT
  e.date_day,
  e.time_category_personal,
  e.duration_min AS estimate_min,
  t.duration_min AS target_min,
  t.direction,
  e.duration_min - t.duration_min AS gap_min,
  CASE
    WHEN t.direction = 'more' AND e.duration_min >= t.duration_min THEN 'on_track'
    WHEN t.direction = 'less' AND e.duration_min <= t.duration_min THEN 'on_track'
    WHEN t.direction = 'neutral' THEN 'neutral'
    ELSE 'off_track'
  END AS status
FROM v_time_daily_estimate e
JOIN v_time_daily_target t USING (date_day, time_category_personal)
WHERE e.calculated_at = (SELECT MAX(calculated_at) FROM v_time_daily_estimate)
  AND t.valid_until IS NULL
```

### plan vs target 比較

```sql
-- plan と target の差分を計算
SELECT
  p.record_date AS date_day,
  p.time_category_personal,
  SUM(p.duration_seconds) / 60 AS plan_min,
  t.duration_min AS target_min,
  t.direction,
  SUM(p.duration_seconds) / 60 - t.duration_min AS gap_min
FROM fct_time_records_plan p
JOIN v_time_daily_target t ON p.record_date = t.date_day
  AND p.time_category_personal = t.time_category_personal
WHERE p.record_date >= CURRENT_DATE
  AND t.valid_until IS NULL
GROUP BY 1, 2, 4, 5
```

## UX フロー

1. **ダッシュボード確認**
   - estimate / target / plan の比較グラフを表示
   - 差分がある場合はハイライト

2. **手動調整**
   - ユーザーが Google Calendar で plan を調整
   - 次回 sync で fct_time_records_plan が更新

3. **（将来）自動提案**
   - target 達成のための plan 提案
   - 「Education を +1時間」などのレコメンド

## 実装ステータス

- [ ] estimate vs target 比較クエリ
- [ ] plan vs target 比較クエリ
- [ ] Grafana ダッシュボード
- [ ] 差分ハイライト表示
- [ ] plan 提案機能（将来）

## 関連ドキュメント

- [ADR-003 フィードバックループ](/design/decisions/adr_003-feedback-loop)
- [004 目標管理（target）](/specifications/schema/core/004-target)
- [005 推定値（estimate）](/specifications/schema/core/005-estimate)
