---
title: 意向（intent）
description: intent（意向）のデータ設計
---

# 意向（intent）

## 概要

ADR-003およびQPIモデルで定義した4 Information（actual/estimate/intent/target）のうち、intentの実装仕様。

intentは「起こしたい」状態を表す主観的・不確実の情報であり、estimateを踏まえて主体が描く理想・願望を含む未来像。

ただし単なる願望ではなく、**過去の統計量（estimate）を参照して設定される数値目標**である。意図は漠然としていてもよいが、はっきりとしているに越したことはない。

**管理コンソールからユーザーが入力し、rawスキーマに保存される。**

## QPIモデルにおける位置づけ

| 軸 | 値 |
|----|-----|
| 主観/客観 | 主観 |
| 確実/不確実 | 不確実 |

```
estimate: 過去3ヶ月の平均は180時間（客観・不確実）
intent: 200時間働きたい（主観・不確実）← ここ
target: 現実的には185時間が妥当（主観・確実）
```

## 設計方針

### intentの本質：関数空間の基底

**intentは `actual(table) → boolean` という関数を指定するデータ構造である。**

intentは評価や計算を行わない。どの関数を使うかを宣言し、実際の計算は外部ロジック（SQL + Python）が実行する。

```
目標: 「Learningを前週比10%増やす」
  ↓
intent: この目標を評価するための関数を指定
  ↓
外部ロジック: intentに従ってactualデータを処理
  ↓
結果: { intent_id: "xxx", achieved: true, measured_value: 40000, ... }
```

### 基底関数の分類

intentは**基底関数**の組み合わせで表現される。基底は2種類：

| 基底 | 入力 → 出力 | 実装 | 例 |
|------|-------------|------|-----|
| filter | table → table | SQL (dbt) | WHERE句 |
| aggregate | table → scalar | Python | SUM, AVG, 比較演算 |

**aggregate の範囲**:
- 集計: `sum`, `avg`, `count`, `max`, `percentile` など
- 比較: `gte`, `lte`, `between` など（number → boolean）
- 論理: `and`, `or`（boolean → boolean）

### 合成による関数構築

複雑な目標は、基底intentの合成で表現する。

```
「Learningを前週比10%増」の分解:

  actual_table
      ↓ filter(Learning, 前週)
  table_1
      ↓ aggregate(sum)
  value_1 (前週の総時間)

  actual_table
      ↓ filter(Learning, 今週)
  table_2
      ↓ aggregate(sum)
  value_2 (今週の総時間)

  [value_1, value_2]
      ↓ aggregate(increase_rate >= 10%)
  boolean (達成/未達成)
```

### 設計原則

| 原則 | 説明 |
|------|------|
| 単一責務 | 各intentは1つの変換のみ |
| 合成可能 | intentの出力が別intentの入力になる |
| 型非依存 | 返り値の型はintentが指定しない |
| 最小限 | 必要最小限の基底で多くを表現 |

### 未解決の設計課題

**dbtとPythonのロジックの組み合わせをJSONでどう表現するか**

- filter（SQL/dbt）とaggregate（Python）を統一的に記述する方法
- intentの合成（参照関係）をどう表現するか
- 評価ロジックがintentをどうパースするか

→ **解決方針: dbtモデルによる実装**（下記参照）

## dbtモデルによる実装（採用方針）

### 方針転換の経緯

当初はJSON DSL（パイプラインアーキテクチャ）を検討したが、以下の理由でdbtモデルとして実装する方針に転換した。

**検討した選択肢**:

| 選択肢 | 説明 | 採否 |
|--------|------|:----:|
| SQL直接 | LLMがSQLを生成、そのまま保存 | △ バリデーション困難 |
| JSON DSL | 独自DSLを設計、SQLに変換 | × 開発コスト大 |
| **dbtモデル** | LLMがdbtモデル(.sql + .yml)を生成 | ✅ 採用 |

**dbtを採用する理由**:

| 要件 | dbtの機能 |
|------|----------|
| SQLバリデーション | `dbt compile` でSQLエラー検出 |
| 依存関係グラフ | `dbt docs generate` + DAG可視化 |
| 人間向け説明 | モデルの `description` フィールド |
| テスト | `dbt test` でデータ品質チェック |
| テンプレート | Jinja2マクロで再利用可能 |

**dbtはSQLのDSL**である。独自DSLを設計する労力をかけずに、同等以上の機能が得られる。

### 実装フロー

```
自然言語（ユーザー入力）
    ↓ LLM
dbtモデル（.sql + .yml）
    ↓ dbt compile
SQLバリデーション
    ↓ dbt run
評価結果（boolean）
    ↓ dbt docs generate
DAG可視化（行動指針の理解）
```

### dbtモデル構成

intentは `models/intent/` ディレクトリに配置する。

```
transform/
└── models/
    └── intent/
        ├── _intent__models.yml        # スキーマ定義
        ├── intent_education_weekly_growth.sql
        ├── intent_sleep_mad_reduction.sql
        └── ...
```

### 実装例

**目標**: 「睡眠の中央絶対偏差を前週比1%減を12週連続」

**スキーマ定義** (`_intent__models.yml`):

```yaml
models:
  - name: intent_sleep_mad_12weeks
    description: |
      睡眠の中央絶対偏差（MAD）を前週比1%減を12週連続で達成する。

      【行動指針】
      MAD（ばらつき）を減らす = 睡眠時間を毎日一定にする
    config:
      tags: ['intent', 'sleep']
      meta:
        category: Sleep
        actionable: true
        target_metric: MAD
        threshold: -0.01
        consecutive_weeks: 12
    columns:
      - name: achieved
        description: "目標達成したか（boolean）"
```

**SQLモデル** (`intent_sleep_mad_12weeks.sql`):

```sql
-- 睡眠の中央絶対偏差を前週比1%減を12週連続
WITH daily_sleep AS (
    SELECT
        record_date,
        SUM(duration_seconds) AS duration
    FROM {{ ref('fct_time_records_actual') }}
    WHERE personal_category = 'Sleep'
    GROUP BY 1
),

weekly_stats AS (
    SELECT
        DATE_TRUNC('week', record_date) AS week,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration) AS median_duration
    FROM daily_sleep
    GROUP BY 1
),

weekly_mad AS (
    SELECT
        w.week,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY ABS(d.duration - w.median_duration)
        ) AS mad
    FROM daily_sleep d
    JOIN weekly_stats w ON DATE_TRUNC('week', d.record_date) = w.week
    GROUP BY 1
),

with_rate AS (
    SELECT
        week,
        mad,
        (mad - LAG(mad) OVER (ORDER BY week))
            / NULLIF(LAG(mad) OVER (ORDER BY week), 0) AS rate
    FROM weekly_mad
)

SELECT
    BOOL_AND(rate <= -0.01) AS achieved,
    COUNT(*) FILTER (WHERE rate <= -0.01) AS consecutive_weeks,
    MIN(week) AS period_start,
    MAX(week) AS period_end
FROM with_rate
WHERE rate IS NOT NULL
```

### DAG可視化による行動指針の理解

`dbt docs generate` で生成されるDAGにより、複雑なKPIの依存関係を可視化できる。

```
fct_time_records_actual
         │
         ↓
    daily_sleep (CTE)
         │
         ↓
   weekly_stats (CTE)
         │
         ↓
    weekly_mad (CTE)      ← MAD = 睡眠時間のばらつき
         │
         ↓
    with_rate (CTE)       ← 週間変化率
         │
         ↓
intent_sleep_mad_12weeks  ← 最終評価（boolean）
```

**可視化から得られる行動指針**:
- MAD（中央絶対偏差）を減らす = 毎日の睡眠時間を一定にする
- 極端に長い/短い睡眠日を避ける

### LLMへのプロンプト設計

LLMにdbtモデルを生成させる際のプロンプト例:

```
以下の目標をdbtモデルとして実装してください。

目標: 「Education週間総時間を前週比1%増で12週連続」

要件:
- {{ ref('fct_time_records_actual') }} を参照
- CTEで段階的に集計
- 最終出力は achieved (boolean) カラム
- YAMLにdescription（行動指針を含む）を記述

出力形式:
1. .sql ファイル
2. .yml ファイル（_intent__models.yml に追記する形式）
```

### メタデータによる分類

YAMLの `meta` フィールドでintentを分類・検索可能にする:

```yaml
meta:
  category: Sleep          # 対象カテゴリ
  actionable: true         # 行動で変えられるか
  target_metric: MAD       # 対象指標
  threshold: -0.01         # 閾値
  consecutive_weeks: 12    # 連続週数
  created_by: llm          # 生成元（llm / manual）
  created_at: 2025-12-11   # 作成日
```

### 廃止: JSON DSLパイプライン

以下の設計は**廃止**とする（参考として残す）:

<details>
<summary>廃止されたパイプライン設計（参考）</summary>

intentを**DataFrameの変換パイプライン**として表現する設計を検討したが、dbtで同等以上の機能が得られるため廃止。

```typescript
// 廃止
interface Intent {
  id: string;
  input: string | "actual";
  transform: {
    type: "filter" | "groupby" | "window" | "compare";
    params: Record<string, any>;
  };
}
```

</details>

intentオブジェクトは**時刻スナップショット**として保存される。過去のintentと現在のactualを比較することで、目標設定の妥当性を振り返ることができる。

### LLMファーストなデータ構造

本設計は「ユーザーが直接入力するUI」ではなく、**LLMが自然言語から生成する**ことを前提としている。

```
従来: ユーザー → 複雑なフォーム → データ構造
本設計: ユーザー → 自然言語 → LLM → dbtモデル → システム
```

**設計の優先順位**:

| 優先度 | 観点 | 理由 |
|:------:|------|------|
| 1 | LLMが生成しやすい | dbtの構造化された形式（.sql + .yml） |
| 2 | システムが実行しやすい | dbt compile/run でバリデーション・実行 |
| 3 | 人間が理解しやすい | dbt docs でDAG可視化、行動指針の把握 |

**この設計が有効な理由**:
- 複雑な目標設定を自然言語で表現可能（例：「Education週間総時間を前週比1%増で3ヶ月連続」）
- ユーザーの学習コストをゼロに
- 独自DSLの開発・保守コストを回避

## 参考: オブジェクト構造（時間ドメイン）

以下は当初検討していたJSONB形式の設計。dbtモデル方式に移行したが、単純な目標の表現や、LLMへのプロンプト設計の参考として残す。

```typescript
interface TimeIntent {
  id: string;                    // 一意識別子（他intentからの参照用）
  filter: TimeIntentFilter;      // どのデータを対象にするか
  measure: TimeIntentMeasure;    // 何を測るか
  standard: TimeIntentStandard;  // どう評価するか
  scope: {
    start: Date;                 // 対象期間開始
    end: Date;                   // 対象期間終了
  };
}
```

### 参照による分解

LLMはユーザーの自然言語を**複数の基本的なintent**に分解する。相対比較を含む目標は、参照先intentと評価intentに分解される。

```
ユーザー入力: 「Learningを前週比10%増やす」
    ↓
LLMが分解:
  intent_1: 前週のLearning総時間を測定（参照用）
  intent_2: 今週のLearning総時間がintent_1の10%増（評価用）
```

この分解により：
- 各intentは単一責務（測定 or 比較）
- 参照先intentは再利用可能
- 評価ロジックはintent_idを辿って値を取得

### 評価フロー

```
┌─────────────────────────────────────────────────────────────────┐
│ filter: どのデータを対象にするか（フィルタリング）                 │
│   例: { personal_category: "Drift" }                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ measure.condition: 日ごとの集計結果をどう評価するか（第1段階）     │
│   例: { value: 3600, operation: "gte" }  // 1時間以上の日を抽出   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ standard: 期間全体の集計結果をどう評価するか（第2段階）            │
│   例: { value: 2, operation: "lte" }  // 2日以下                 │
└─────────────────────────────────────────────────────────────────┘
```

### filter構造

actualとの比較対象を指定する。

```typescript
interface TimeIntentFilter {
  // データ属性フィルタ
  personal_category?: string;   // "Learning", "Work", etc.
  project?: string;             // project_name
  tags?: string[];              // AND条件

  // 時間フィルタ
  day_of_week?: number[];       // 0=日, 1=月, ..., 6=土
  time_range?: {                // 時間帯フィルタ
    start: string;              // "09:00" (HH:mm形式)
    end: string;                // "12:00"
  };

  // 複合条件
  _and?: TimeIntentFilter[];    // AND条件（すべて満たす）
  _or?: TimeIntentFilter[];     // OR条件（いずれか満たす）
}
```

**フィルタ評価ルール**:
- 同一オブジェクト内の複数フィールドはAND条件
- `_and` / `_or` でネスト可能（再帰的）
- `_and` と `_or` の同時指定は不可

### filterフィールドの由来

Togglエントリーのフィールドから、intent設定に必要なものを抽出。

| フィールド | 型 | 例 | 由来 |
|-----------|-----|-----|------|
| `personal_category` | string | `"Learning"` | マスタでマッピング |
| `project` | string | `"programming"` | Toggl project_name |
| `tags` | string[] | `["focus", "solo"]` | Toggl tags |

**除外したフィールド**: `description`, `billable`, `task_id`, `workspace_id`

### measure構造

「何を測るか」を指定する。

```typescript
interface TimeIntentMeasure {
  type: MeasureType;
  unit?: "day" | "week" | "month";     // 集計単位（デフォルト: day）
  condition?: {                        // 単位ごとの条件（type依存）
    value: number;                     // 秒（絶対値指定）
    operation: "gte" | "lte" | "eq" | "gt" | "lt";
  };
  timing?: {                           // timing用
    field: "start" | "end";            // 開始時刻 or 終了時刻
    time: string;                      // "06:00" (HH:mm形式)
    operation: "before" | "after" | "between";
    time2?: string;                    // betweenの場合
  };
  params?: {                           // type別パラメータ
    percentile?: number;               // percentile用 (0-100)
    q1?: number;                       // iqr用 (デフォルト25)
    q3?: number;                       // iqr用 (デフォルト75)
    trim?: number;                     // trimmed_mean用 (0-50%)
  };
}
```

※ 相対比較（前週比など）は`standard.reference`でintent_id参照を使用

#### measure.unit（集計単位）

`unit`は集計の粒度を指定する。`streak`や`days`などのtype評価時に使用。

| unit | 説明 | 例 |
|------|------|-----|
| `day` | 日単位（デフォルト） | 「5日連続」 |
| `week` | 週単位 | 「12週連続」 |
| `month` | 月単位 | 「6ヶ月連続」 |

#### condition.reference（廃止）

~~`condition.reference`は「前の単位との比較」を指定する。~~

**設計変更**: 相対比較は`standard.reference`でのintent_id参照に統一。

理由：
- intentは「評価方法の宣言」であり、値の計算は行わない
- 「前週との比較」は参照先intentを明示的に指定すべき
- 連続達成の追跡は評価ロジック側の責務

#### measure.type 一覧

| type | 説明 | 例 | 優先度 |
|------|------|-----|:------:|
| `total` | 期間内の合計時間 | 「12月にLearning100時間」 | 高 |
| `days` | 条件を満たす日数 | 「driftが1時間以上の日を2日以下」 | 高 |
| `streak` | 条件を満たす連続日数 | 「Education5日連続」 | 高 |
| `average` | 期間内の日平均 | 「睡眠を週平均7時間」 | 高 |
| `timing` | 開始/終了の時刻 | 「6時前に起床」 | 高 |
| `frequency` | 期間内の発生回数 | 「週に3回ジムに行く」 | 中 |
| `max` | 日ごとの最大値 | 「1日の残業は3時間以内」 | 中 |
| `stddev` | 標準偏差 | 「睡眠時間の標準偏差を30分以内」 | 中 |
| `variance` | 分散 | 「睡眠時間の分散を一定以内」 | 中 |
| `range` | 範囲(max-min) | 「睡眠時間の振れ幅を2時間以内」 | 中 |
| `iqr` | 四分位範囲(Q3-Q1) | 「食事時間のIQRを30分以内」 | 中 |
| `percentile` | 任意のパーセンタイル | 「睡眠時間の90%ileが8時間以下」 | 中 |
| `trimmed_mean` | トリム平均 | 「睡眠時間のトリム平均が7時間」 | 中 |
| `min` | 日ごとの最小値 | 「毎日最低30分は運動」 | 低 |
| `median` | 中央値 | 「睡眠時間の中央値が7時間以上」 | 低 |
| `ratio` | 割合 | 「Workのうちfocusが50%以上」 | 低 |
| `gap` | 間隔 | 「Exerciseの間隔が3日以上空かない」 | 低 |

#### 外れ値に頑健な統計量

| 統計量 | 外れ値の影響 | 用途 |
|--------|:----------:|------|
| `stddev` / `variance` | 大 | 全体のばらつき |
| `range` | 大 | 最大振れ幅 |
| `iqr` | 小 | 中央50%のばらつき |
| `trimmed_mean` | 小 | 外れ値を除いた平均 |
| `percentile` | 小 | 任意の位置の値 |

#### frequency vs days

| 状況 | days | frequency |
|------|------|-----------|
| 月曜に1回meditation | 1日 | 1回 |
| 月曜に3回meditation | 1日 | 3回 |
| 月・水・金に各1回 | 3日 | 3回 |
| 月に2回、水に1回 | 2日 | 3回 |

- `days`: 条件を満たす**日数**（1日に複数回やっても1日）
- `frequency`: **回数**（1日に3回やれば3回カウント）

#### type別の必須フィールド

| type | condition | timing |
|------|:---------:|:------:|
| `total` | - | - |
| `days` | 必須 | - |
| `streak` | 必須 | - |
| `average` | - | - |
| `timing` | - | 必須 |
| `frequency` | 必須 | - |
| `max` | - | - |
| `stddev` | - | - |
| `variance` | - | - |
| `range` | - | - |
| `min` | - | - |
| `median` | - | - |
| `ratio` | 必須 | - |
| `gap` | 必須 | - |

### standard構造

期間全体の集計結果をどう評価するかを指定する。

```typescript
interface TimeIntentStandard {
  // 絶対値による評価
  value?: number;
  operation?: "gte" | "lte" | "eq" | "between";
  value2?: number;              // betweenの場合の上限

  // 相対比較（他intentとの比較）
  reference?: {
    intent_id: string;          // 参照先intentのID
    comparison: "increase" | "decrease" | "maintain";
    threshold?: number;         // 変化率の閾値（%）。例: 10 = 10%増/減
  };
}
```

**相対比較の評価**:
- `increase`: 参照intentの値より `threshold`% 以上増加
- `decrease`: 参照intentの値より `threshold`% 以上減少
- `maintain`: 参照intentの値から `threshold`% 以内の変動

※ `value` と `reference` は排他的（どちらか一方を指定）

※ `standard`という名称はQPIモデルの`target`（意向を調整して確定した目標）と区別するため。

**intent_id参照の利点**:
- 参照先の期間・フィルタを明示的に指定可能
- 評価ロジックがシンプル（intent_idを辿るだけ）
- 複雑な参照パターンも表現可能（同月昨年、3ヶ月平均など）

### 使用例

```typescript
// 12月にLearningを100時間以上
{
  filter: { personal_category: "Learning" },
  measure: { type: "total" },
  standard: { value: 360000, operation: "gte" },  // 秒
  scope: { start: "2025-12-01", end: "2025-12-31" }
}

// driftが1時間以上の日を2日以下にする
{
  filter: { personal_category: "Drift" },
  measure: {
    type: "days",
    condition: { value: 3600, operation: "gte" }  // 1時間以上の日を数える
  },
  standard: { value: 2, operation: "lte" },  // 2日以下
  scope: { start: "2025-12-01", end: "2025-12-31" }
}

// focusタグを週に3日以上つける
{
  filter: { tags: ["focus"] },
  measure: {
    type: "days",
    condition: { value: 1, operation: "gte" }  // 1秒以上（存在すればOK）
  },
  standard: { value: 3, operation: "gte" },  // 3日以上
  scope: { start: "2025-12-08", end: "2025-12-14" }  // 1週間
}

// Educationを5日連続で続ける
{
  filter: { personal_category: "Education" },
  measure: {
    type: "streak",
    condition: { value: 1, operation: "gte" }  // 存在すればOK
  },
  standard: { value: 5, operation: "gte" },  // 5日連続
  scope: { start: "2025-12-01", end: "2025-12-31" }
}

// Workカテゴリのclient-Aプロジェクトを月80時間
{
  filter: { personal_category: "Work", project: "client-A" },
  measure: { type: "total" },
  standard: { value: 288000, operation: "gte" },  // 80時間 = 288000秒
  scope: { start: "2025-12-01", end: "2025-12-31" }
}

// 6時よりも前に起床する（Sleepのend_atが6:00より前）を週5日以上
{
  filter: { personal_category: "Sleep" },
  measure: {
    type: "timing",
    timing: { field: "end", time: "06:00", operation: "before" }
  },
  standard: { value: 5, operation: "gte" },  // 5日以上
  scope: { start: "2025-12-01", end: "2025-12-07" }
}

// 睡眠を週平均7時間以上
{
  filter: { personal_category: "Sleep" },
  measure: { type: "average" },
  standard: { value: 25200, operation: "gte" },  // 7時間 = 25200秒
  scope: { start: "2025-12-01", end: "2025-12-07" }
}

// meditationを週に1回以上行う
{
  filter: { project: "meditation" },
  measure: {
    type: "frequency",
    condition: { value: 1, operation: "gte" }  // 1秒以上（存在すればOK）
  },
  standard: { value: 1, operation: "gte" },  // 1回以上
  scope: { start: "2025-12-08", end: "2025-12-14" }
}

// 月曜と金曜にExerciseを行う（曜日指定）
{
  filter: {
    personal_category: "Exercise",
    day_of_week: [1, 5]  // 月曜・金曜
  },
  measure: {
    type: "days",
    condition: { value: 1, operation: "gte" }
  },
  standard: { value: 2, operation: "gte" },  // 2日以上
  scope: { start: "2025-12-01", end: "2025-12-07" }
}

// 午前中にDeep Workを2時間以上（時間帯フィルタ）
{
  filter: {
    personal_category: "Work",
    tags: ["deep"],
    time_range: { start: "09:00", end: "12:00" }
  },
  measure: { type: "total" },
  standard: { value: 7200, operation: "gte" },  // 2時間
  scope: { start: "2025-12-01", end: "2025-12-01" }  // 1日
}

// Learningを前週比10%増やす（相対比較 - intent分解方式）
// LLMが生成する2つのintent:

// intent_1: 参照用（前週のLearning総時間）
{
  id: "learning-prev-week-2025w49",
  filter: { personal_category: "Learning" },
  measure: { type: "total" },
  standard: { value: 0, operation: "gte" },  // 測定のみ（常に達成）
  scope: { start: "2025-12-01", end: "2025-12-07" }  // 前週
}

// intent_2: 評価用（今週がintent_1の10%増）
{
  id: "learning-this-week-2025w50",
  filter: { personal_category: "Learning" },
  measure: { type: "total" },
  standard: {
    reference: {
      intent_id: "learning-prev-week-2025w49",
      comparison: "increase",
      threshold: 10
    }
  },
  scope: { start: "2025-12-08", end: "2025-12-14" }  // 今週
}

// WorkまたはEducationを1日4時間以上（OR条件）
{
  filter: {
    _or: [
      { personal_category: "Work" },
      { personal_category: "Education" }
    ]
  },
  measure: { type: "average" },
  standard: { value: 14400, operation: "gte" },  // 4時間
  scope: { start: "2025-12-01", end: "2025-12-07" }
}

// 平日の午前中にExercise（複合フィルタ）
{
  filter: {
    personal_category: "Exercise",
    day_of_week: [1, 2, 3, 4, 5],  // 月〜金
    time_range: { start: "06:00", end: "09:00" }
  },
  measure: {
    type: "days",
    condition: { value: 1, operation: "gte" }
  },
  standard: { value: 3, operation: "gte" },  // 週3日以上
  scope: { start: "2025-12-01", end: "2025-12-07" }
}

// Education週間総時間が前週比1%増を12週連続達成
// この目標は単一intentでは表現困難。評価ロジック側で週ごとの比較を行う。
// 以下は「今週が前週より1%増」という単週の目標として表現:
{
  id: "education-weekly-growth-2025w50",
  filter: { personal_category: "Education" },
  measure: { type: "total" },
  standard: {
    reference: {
      intent_id: "education-weekly-total-2025w49",  // 前週のintent
      comparison: "increase",
      threshold: 1
    }
  },
  scope: { start: "2025-12-08", end: "2025-12-14" }
}

// 連続達成の追跡は評価ロジック側の責務:
// - 毎週、前週のintentを参照する新intentをLLMが生成
// - 評価結果テーブルで連続達成をカウント

// Learning月間総時間が前月比5%増（単月の目標）
{
  id: "learning-monthly-growth-2025-12",
  filter: { personal_category: "Learning" },
  measure: { type: "total" },
  standard: {
    reference: {
      intent_id: "learning-monthly-total-2025-11",  // 前月のintent
      comparison: "increase",
      threshold: 5
    }
  },
  scope: { start: "2025-12-01", end: "2025-12-31" }
}

// 週間Exercise時間を前週と±10%以内に維持
{
  id: "exercise-weekly-maintain-2025w50",
  filter: { personal_category: "Exercise" },
  measure: { type: "total" },
  standard: {
    reference: {
      intent_id: "exercise-weekly-total-2025w49",
      comparison: "maintain",
      threshold: 10                          // ±10%以内
    }
  },
  scope: { start: "2025-12-08", end: "2025-12-14" }
}
```

## ストレージ形式

intentは**dbtモデル**として保存する。

```
transform/models/intent/
├── _intent__models.yml        # スキーマ定義（description, meta）
├── intent_*.sql               # 評価ロジック（SQL）
└── ...
```

- **SQL**: 評価ロジック（CTEで段階的に集計、最終出力は `achieved` boolean）
- **YAML**: メタデータ（description, category, actionable, threshold等）
- **DAG**: `dbt docs generate` で依存関係を可視化

## 管理コンソールからの入力

### 入力方式の選択

| 方式 | 説明 | 採否 |
|------|------|:----:|
| ①自然言語のみ | テキストをそのまま保存 | × 曖昧さ、再現性低 |
| **②構造化フィールド** | 期間・指標等を明示的に入力 | ✅ 採用 |

**②を採用する理由**:

| 観点 | ①自然言語のみ | ②構造化フィールド |
|------|:------------:|:-----------------:|
| 入力の手軽さ | ◎ 自由記述 | △ フォーム入力 |
| LLM変換精度 | △ 曖昧さが残る | ◎ 明確なパラメータ |
| 期間の指定 | △ 「来月」→解釈ブレ | ◎ 日付ピッカーで確定 |
| 再現性 | △ 同じ文言でも異なるSQL | ◎ 同じ入力→同じSQL |
| デバッグ | △ 何が意図だったか不明 | ◎ 入力値が明確 |

### 入力スキーマ

```typescript
interface IntentInput {
  // 構造化（必須）
  category: string;           // "Sleep", "Education", ...
  metric: string;             // "total", "mad", "streak", ...
  period_start: Date;
  period_end: Date;

  // 構造化（任意）
  threshold?: number;         // 閾値
  comparison?: "gte" | "lte"; // 比較方向
  consecutive?: number;       // 連続週/日数

  // 自然言語（補足）
  description?: string;       // 「平日も休日も同じリズムで寝たい」等
}
```

**descriptionの役割**: 構造化しにくい意図を補足。LLMが行動指針の生成に利用。

### 変換フロー

```
管理コンソール（構造化入力）
    ↓
IntentInput（DB保存）
    ↓ LLaMA API
dbtモデル（.sql + .yml）生成
    ↓ dbt compile
SQLバリデーション（エラー時はリトライ）
    ↓
models/intent/ に配置
```

### LLMによるdbt変換

**実行環境**: Claude Desktop（MCP経由でDBスキーマ参照）

#### LLMに渡すコンテキスト

| データ | ソース | 必須 | 用途 |
|--------|--------|:----:|------|
| **actualスキーマ** | `fct_time_records_actual` | ✅ | カラム名・型 |
| **カテゴリ一覧** | `mst_time_personal_categories` | ✅ | 有効な`personal_category`値 |
| **プロジェクト一覧** | `stg_toggl__projects` | - | 有効な`project_name`値 |
| **クライアント一覧** | `stg_toggl__clients` | - | 有効な`client_name`値 |
| **IntentInput** | ユーザー入力 | ✅ | 生成対象 |
| **Few-shot例** | 既存intent | ✅ | 出力形式の学習 |

#### プロンプト構成

```
## 参照テーブル
fct_time_records_actual:
  - record_date: DATE
  - personal_category: TEXT
  - duration_seconds: INTEGER
  - start_at: TIMESTAMPTZ
  - end_at: TIMESTAMPTZ

## カテゴリ一覧（mst_time_personal_categories.name）
- Sleep
- Education
- Work
- Exercise
- ...

## プロジェクト一覧（stg_toggl__projects.name）
- programming
- reading
- meditation
- ...

## 入力（IntentInput）
category: Sleep
metric: mad
period: 2025-01-01 ~ 2025-03-31
threshold: -0.01
consecutive: 12
description: 「毎日同じ時間に寝たい」

## 出力形式
1. .sql（CTE形式、最終出力は achieved boolean）
2. .yml（description + meta）

## 例
[Few-shot例をここに]
```

#### MCP連携（Claude Desktop）

Claude DesktopのMCPでSupabaseに接続し、スキーマ・マスタデータを動的に取得可能。

```
[MCP Server: Supabase]
  → DBスキーマ参照（information_schema）
  → マスタデータ参照（mst_*, stg_*）
```

#### 精度向上策

| 手法 | 説明 |
|------|------|
| Few-shot | 2-3個の正解例をプロンプトに含める |
| スキーマ情報 | 参照テーブルのカラム定義を明示 |
| マスタデータ | カテゴリ・プロジェクト一覧を提供 |
| dbt compile検証 | 生成後に自動でバリデーション |
| リトライ | エラー時はエラーメッセージを含めて再生成 |

## 未検討事項

### 解決済み

- [x] valueの単位 → 秒（Togglに合わせる。UIでは時間/分で入力可）
- [x] scopeの粒度指定 → measure.typeで表現（total/days/streak等）
- [x] measure.typeの洗い出し → 17種類（優先度付き、統計量含む）
- [x] 複合条件（AND/OR） → SQLのWHERE句で表現
- [x] 曜日指定 → SQLのEXTRACT(DOW FROM ...)
- [x] 時間帯フィルタ → SQLのEXTRACT(HOUR FROM ...)
- [x] 相対比較 → SQLのLAG/LEADウィンドウ関数
- [x] 集計単位（日/週/月） → SQLのDATE_TRUNC
- [x] intentの役割明確化 → dbtモデルとして実装
- [x] 参照による分解 → dbtの {{ ref() }} で依存関係を表現

### 設計課題（次の検討事項）

- [x] **intentのDSL設計** → dbtモデル（SQL + YAML）で解決、独自DSL不要
- [x] **依存関係の可視化** → `dbt docs generate` でDAG生成
- [x] **SQLバリデーション** → `dbt compile` でエラー検出
- [ ] **LLMプロンプト設計** → dbtモデル生成のためのプロンプトテンプレート
- [ ] **intentの履歴管理** → Gitでバージョン管理、または別テーブルでスナップショット

### 将来検討

- [ ] 順序・遷移（「Workの後にRest」など） → 複雑なため将来検討
- [ ] timingの日またぎ処理（Sleepのend_atがどの日にカウントされるか）
- [ ] 1日に複数エントリがある場合の処理（timing）
- [ ] intent → target 変換ロジック

## 関連ドキュメント

### 内部ドキュメント

- [011 QPIモデル](/01-product/000-foundations/010-theory/011-qpi-model) - intent概念定義
- [131 ADR-003 フィードバックループ](/01-product/100-development/130-design/131-decisions/adr_003-feedback-loop) - 4 Information概念
- [124 管理コンソール仕様](/01-product/100-development/120-specifications/124-console/console-dashboard) - 管理コンソール全体仕様
- [123 目標管理（target）](/01-product/100-development/120-specifications/123-transform/schema/core/004-target) - targetの設計（intentの次工程）
- [123 推定値（estimate）](/01-product/100-development/120-specifications/123-transform/schema/core/005-estimate) - estimateの設計（intentの前工程）

### LLMファースト設計に関する外部参考資料

本設計の「LLMが生成しやすいデータ構造」というアプローチは、確立された理論ではなく本プロジェクトの設計方針である。ただし、類似の課題に取り組む開発者の議論が増えている。

| 記事 | 概要 |
|------|------|
| [Structured data extraction using LLM schemas](https://simonwillison.net/2025/Feb/28/llm-schemas/) (Simon Willison) | 「非構造化データから構造化データへの変換はLLMの最も商業的に価値のある応用」。スキーマ設計の実践的考察、JSON Schema vs 独自DSLの選択 |
| [Ten Lessons of Building LLM Applications](https://towardsdatascience.com/ten-lessons-of-building-llm-applications-for-engineers/) | LLMアプリ構築の3本柱：Pipeline設計、Role設計、Data flow & context設計 |
| [Making LLMs Work with Your Existing Data Systems](https://jonathangardner.io/making-llms-work-with-your-existing-data-systems-a-technical-leaders-guide-to-ai-integration/) | 「人間向けではなく機械理解のためのデータ準備」という視点。セマンティック境界を意識したチャンキング |
| [The architecture of today's LLM applications](https://github.blog/ai-and-ml/llms/the-architecture-of-todays-llm-applications/) (GitHub Blog) | LLMアプリのアーキテクチャパターン。キャッシング戦略、一貫性のある出力生成 |
| [Introducing Structured Outputs in the API](https://openai.com/index/introducing-structured-outputs-in-the-api/) (OpenAI) | Structured Outputの公式ガイド。JSON Schema指定による100%の構造準拠 |
| [LLMs For Structured Data](https://neptune.ai/blog/llm-for-structured-data) | LLMと構造化データの相互作用。SQLクエリ生成、統計抽出、合成データ生成 |
