---
title: ADR-006 estimate設計
description: 時間推定値の計算・保存設計（出力テーブル優先アプローチ）
---

# ADR-006: estimate設計

## ステータス

採用（2025-12-07）

## コンテキスト

estimateは「起こりうる」＝予測値を表す。過去の実績（actual）から将来の時間配分を推定し、目標設定や計画立案の参考にする。

## 決定

出力テーブル（`fct_time_estimate_snapshots`）を優先し、アルゴリズム実装は後回しにする。

## 基本方針

```
┌─────────────────────────────────────────────────────┐
│  fct_time_estimate_snapshots（出力テーブル）          │
│  - これさえあれば可視化・分析が可能                    │
│  - アルゴリズムがどう計算したかは問わない              │
└─────────────────────────────────────────────────────┘
                        ↑
┌─────────────────────────────────────────────────────┐
│  Estimator（後で実装）                               │
│  - dbt SQL / Python / ML / 外部API 何でもOK         │
│  - 入出力インターフェースさえ守れば自由               │
└─────────────────────────────────────────────────────┘
```

**核心的な洞察**: `fct_time_estimate_snapshots`テーブルさえあれば、可視化・分析は可能。アルゴリズムの実装詳細は後回しにできる。

## 入出力インターフェース（確定）

### 入力

```
- target_date: DATE          -- 推定対象日
- day_type: TEXT             -- 集計対象のday_type
- time_actual: TABLE/VIEW    -- 日次実績（fct_time_actual等）
```

### 出力

```json
{
  "date": "2025-12-07",
  "day_type": "Work",
  "Sleep": 420,
  "Work": 480,
  "Education": 120,
  ...
  "_meta": {
    "sample_count": 30,
    "actual_count": 25,
    "actual_ratio": 0.83,
    "variance": 156.2
  }
}
```

入出力の型さえ守れば、アルゴリズム内部の実装は自由。

## fct_time_estimate_snapshots

### テーブル定義

| カラム | 型 | 説明 |
|--------|-----|------|
| id | SERIAL | PK |
| calculated_at | TIMESTAMPTZ | スナップショット作成時刻 |
| target_date | DATE | 推定対象日 |
| day_type | TEXT | その日のday_type |
| algorithm_version | TEXT | アルゴリズムID |
| estimates | JSONB | 全カテゴリの推定値 + メタデータ |

### estimates JSONB構造

```json
{
  "Sleep": 420,
  "Essential": 60,
  "Work": 480,
  "Education": 120,
  "Leisure": 180,
  "Household": 30,
  "Learning": 60,
  "Exercise": 30,
  "Manage": 30,
  "Drift": 30,
  "_meta": {
    "sample_count": 30,
    "actual_count": 25,
    "actual_ratio": 0.83,
    "variance": 156.2
  }
}
```

### メタデータの意義

- **sample_count**: 窓内で使用した日数
- **actual_count**: そのうちactualだった日数
- **actual_ratio**: actual_count / sample_count（信頼度指標）
- **variance**: 推定値の分散

### 正規化ビュー

分析時に正規化が必要な場合はビューで展開する。

```sql
-- v_time_estimate_normalized
SELECT
  calculated_at,
  target_date,
  day_type,
  algorithm_version,
  category,
  (estimates->>category)::INTEGER as estimate_min,
  (estimates->'_meta'->>'sample_count')::INTEGER as sample_count,
  (estimates->'_meta'->>'actual_count')::INTEGER as actual_count,
  (estimates->'_meta'->>'actual_ratio')::NUMERIC as actual_ratio,
  (estimates->'_meta'->>'variance')::NUMERIC as variance
FROM fct_time_estimate_snapshots,
     LATERAL jsonb_object_keys(estimates) as category
WHERE category != '_meta';
```

## 統合ビュー

### v_time_unified_plan（actual + plan統合）

過去はactual、未来はplanを使用。「予定通りやれば」の世界を表現。

```sql
SELECT date, 'actual' as source, time_category_personal, duration_min
FROM fct_time_actual
WHERE date < CURRENT_DATE
UNION ALL
SELECT date, 'plan' as source, time_category_personal, duration_min
FROM fct_time_planned
WHERE date >= CURRENT_DATE
```

### v_time_unified_estimate（actual + estimate統合）

過去はactual、未来はestimateを使用。「今の傾向が続けば」の世界を表現。

```sql
-- 概念（実装は再帰的計算が必要）
SELECT date, 'actual' as source, time_category_personal, duration_min
FROM fct_time_actual
WHERE date < CURRENT_DATE
UNION ALL
SELECT date, 'estimate' as source, time_category_personal, estimate_min
FROM (再帰的estimate計算)
WHERE date >= CURRENT_DATE
```

### 計算量の比較

| ビュー | 未来の値 | 計算量 | 意味 |
|--------|---------|--------|------|
| v_time_unified_plan | plan値そのもの | O(1) | 予定通りやる前提 |
| v_time_unified_estimate | 再帰的estimate | O(n) | 今の傾向が続く前提 |

## 窓の解釈：「同day_typeのN日分」

**問題**: カレンダー日数で窓を取ると、該当day_typeがない期間はサンプル0になる

```
例: 直近3日が全部Leisure day
  → カレンダー日解釈: Work estimateのサンプル0 → 意味なし
  → 同day_type解釈: 直近のWorkday 3日分を遡って取得 → 意味ある
```

**採用**: 「同day_typeの直近N日分」で計算

## 実装の選択肢（後で決定）

| 方式 | 特徴 | 適用例 |
|------|------|--------|
| dbt SQL | dbt docs連携、lineage可視化 | 単純な移動平均 |
| Python + Supabase書き込み | 最も柔軟、ML対応 | Prophet、ニューラルネット |
| 外部API | 専門サービス活用 | AutoML等 |

## 当面の進め方

1. `fct_time_estimate_snapshots`テーブルを作成
2. 手動またはシンプルなスクリプトでテストデータを投入
3. 可視化・分析の仕組みを構築
4. アルゴリズム実装は後から追加

## 未決定事項（後回し）

1. **アルゴリズム管理テーブル設計**: mst_estimate_algorithms
2. **具体的なアルゴリズム実装**: v1_short, v1_long, v1_year, v1_mix等
3. **再帰計算の実装方式**: SQL CTE or バッチ処理

## 参考: アルゴリズム案（将来実装）

窓ごとに別アルゴリズムとして定義する案。

| version | window_days | 説明 |
|---------|-------------|------|
| v1_short | 7 | 直近7日平均（短期トレンド） |
| v1_long | 30 | 直近30日平均（中期トレンド） |
| v1_year | 360 | 直近360日平均（長期実績） |
| v1_mix | null | 分散の逆数で重み付けした平均 |

**v1_mixの計算:**
```
weight_i = 1 / variance_i
normalized_weight_i = weight_i / Σ(weight_j)
estimate = Σ(normalized_weight_i × estimate_i)
```

分散が小さい（安定している）窓の値を重視する。

## 関連

- [ADR-003 時間管理フィードバックループ](/design/decisions/adr_003-time-feedback-loop)
- [ADR-004 day_type設計](/design/decisions/adr_004-day-type-design)
- [ADR-005 target設計](/design/decisions/adr_005-target-design)
