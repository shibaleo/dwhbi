---
title: 004 目標管理（target）
description: target（目標）の集計形式設計
---

# 目標管理（target）

## 概要

ADR-003で定義した4 Information（actual/estimate/target/plan）のうち、targetの実装仕様。

targetは「起こしたい」状態を表す主観的・未確定の情報であり、最終的にmartsでの集計（達成率計算等）に使用される。

## 設計方針

### 集計形式を採用

targetは**集計形式**（日 × カテゴリ → 目標時間）で管理する。

**理由:**
- actual/planのようなレコード形式（start_at/end_at）は、目標時間を達成しながら切れ目なく配置するレコード生成が複雑
- 最終用途はmartsでの集計（KPI計算）であり、集計形式で十分
- seeds CSVで直感的に編集可能

## ストレージ形式

JSONB で非正規化して保存し、ビューで正規化する。

### テーブル構造

```sql
-- core.fct_time_daily_target
CREATE TABLE core.fct_time_daily_target (
  date_day DATE NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (date_day, (data->'meta'->>'valid_from')::date)
);
```

### JSONB 形式

```json
{
  "target": {
    "Sleep": 420,
    "Work": 480,
    "Education": 600
  },
  "direction": {
    "Sleep": "neutral",
    "Work": "neutral",
    "Education": "more"
  },
  "meta": {
    "valid_from": "2025-12-06",
    "valid_until": null,
    "scope_start": "2025-12-06",
    "scope_end": "2025-12-31"
  }
}
```

- `target`: カテゴリ名 → 目標時間（分）のマップ
- `direction`: カテゴリ名 → 達成方向（more/less/neutral）のマップ
- `meta`: メタ情報（有効期間、目標期間）

※ プロパティ名は `mst_time_personal_categories.name` に一致させる

## 正規化ビュー

```sql
-- core.v_time_daily_target
SELECT
  date_day,
  key AS time_category_personal,
  value::integer AS duration_min,
  data->'direction'->>key AS direction,
  (data->'meta'->>'valid_from')::date AS valid_from,
  (data->'meta'->>'valid_until')::date AS valid_until,
  (data->'meta'->>'scope_start')::date AS scope_start,
  (data->'meta'->>'scope_end')::date AS scope_end
FROM core.fct_time_daily_target,
LATERAL jsonb_each_text(data->'target')
```

### 正規化後の列構成

| 列名 | 型 | 説明 |
|------|-----|------|
| date_day | date | 対象日 |
| time_category_personal | text | カテゴリ |
| duration_min | integer | 目標時間（分） |
| direction | text | 達成方向（more/less/neutral） |
| valid_from | date | 有効開始日 |
| valid_until | date | 有効終了日（NULL=現在有効） |
| scope_start | date | 目標期間開始 |
| scope_end | date | 目標期間終了 |

※ `day_type` は `dim_day_types` から JOIN で取得する

## 履歴管理

targetの時間変化を分析するため、SCD Type 2 形式で履歴を保持する。

- `valid_from` / `valid_until`: 目標値の有効期間
- 同一 date_day に対して複数の履歴レコードが存在しうる
- 現在有効な目標は `valid_until IS NULL` で抽出

## seeds テーブル設計

### mst_time_target_groups（目標グループ）

目標の「何を」「どの日に」「どの方向で」達成したいかを定義。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | integer | PK |
| name | text | グループ識別子（edu_dec等） |
| time_category_personal | text | FK → mst_time_personal_categories |
| day_type | text | 対象日タイプ（all/Work/Leisure/Education等） |
| direction | text | 達成方向（more/less/neutral） |
| valid_from | date | 有効開始日 |
| valid_until | date | 有効終了日（NULL=無期限） |
| description | text | 説明 |

### mst_time_targets（目標値）

目標グループに対する具体的な数値目標。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | integer | PK |
| group_id | integer | FK → mst_time_target_groups |
| version | text | セマンティックバージョン |
| scope_start | date | 目標期間開始 |
| scope_end | date | 目標期間終了 |
| target_min | integer | 目標時間（分） |
| valid_from | date | この目標値の有効開始日 |
| valid_until | date | 有効終了日（NULL=無期限） |
| description | text | 説明 |

## direction の意味

| direction | 意味 | 達成条件 |
|-----------|------|----------|
| more | より多く | actual >= target |
| less | より少なく | actual <= target |
| neutral | 参考値 | 達成率計算のみ |

## 使用例

```csv
# mst_time_target_groups
id,name,time_category_personal,day_type,direction
1,edu_dec,Education,Education,more      # Education日にEducationをもっと
2,sleep_daily,Sleep,all,neutral         # 毎日の睡眠（参考値）
3,drift_daily,Drift,all,less            # 毎日の漂流を減らす
4,work_workday,Work,Work,neutral        # 勤務日のWork（参考値）
5,leisure_leisure,Leisure,Leisure,more  # 休日にLeisureをもっと

# mst_time_targets
id,group_id,scope_start,scope_end,target_min,description
1,1,2025-12-06,2025-12-31,600,12月Education 10h目標
2,2,2025-01-01,2099-12-31,420,睡眠7時間/日
3,3,2025-01-01,2099-12-31,60,漂流1時間/日以下
```

## martsでの使用（想定）

```sql
-- marts.kpi_daily_achievement
SELECT
  d.date_day,
  d.day_type,
  t.time_category_personal,
  t.direction,
  t.target_min,
  a.actual_min,
  CASE t.direction
    WHEN 'more' THEN a.actual_min >= t.target_min
    WHEN 'less' THEN a.actual_min <= t.target_min
    ELSE NULL
  END AS is_achieved,
  ROUND(a.actual_min::numeric / NULLIF(t.target_min, 0) * 100, 1) AS achievement_rate
FROM dim_day_types d
JOIN target_daily t ON d.day_type = t.day_type OR t.day_type = 'all'
LEFT JOIN actual_daily a ON d.date_day = a.date_day
  AND t.time_category_personal = a.time_category_personal
```

## 未実装事項

### estimate → target → plan 反映の仕組み

ADR-003 のフィードバックループに従い、estimate を考慮して target を plan に反映する仕組みが必要:

1. **estimate 参照**: 過去の実績から「できる」を把握
2. **target 設定**: estimate を踏まえて「したい」を決定
3. **plan 調整**: target と現実制約を擦り合わせて「する」を決定

**実装方針（案）**:
- Grafana ダッシュボードで estimate / target の差分を可視化
- ユーザーが Google Calendar で plan を手動調整
- 将来的には plan 提案機能を実装

### 長期目標の day_type 別配分

長期的な目標（例：月間100時間の勉強）を day_type ごとに日次 target に配分する仕組みが必要:

**例**: 月間 Education 100時間目標
- Education日: 8時間/日 × 10日 = 80時間
- Work日: 1時間/日 × 15日 = 15時間
- Leisure日: 1時間/日 × 5日 = 5時間

**実装方針（案）**:
- seeds に長期目標テーブル（`mst_time_long_term_targets`）を追加
- day_type 別の配分比率を定義
- dbt モデルで日次 target を自動生成

## 関連ドキュメント

- [131 ADR-003 フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop) - 4 Information概念
- [131 ADR-004 day_type設計](/100-development/130-design/131-decisions/adr_004-day-type-design) - 日タイプ導出
- [123 推定値（estimate）](/100-development/120-specifications/123-transform/schema/core/005-estimate) - 推定値の設計
