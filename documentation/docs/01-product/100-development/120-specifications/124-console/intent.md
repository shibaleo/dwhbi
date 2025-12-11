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

## 実装方式

dbtモデルとして実装する。

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

## ユーザーストーリー

```
プロンプト入力 → LLMがdbtモデル生成 → ビルド＋デプロイ
```

### 実装フロー

```
1. 自然言語（ユーザー入力）
    ↓ LLM（Claude等）
2. dbtモデル（.sql + .yml）を models/intent/ に生成
    ↓
3. python packages/transform/scripts/run_dbt.py deploy
    ↓ dbt run → dbt test → dbt docs generate → consoleにコピー
4. 評価結果 + DAG可視化
```

### デプロイコマンド

```bash
# 一括実行（run + test + docs generate + consoleへコピー）
python packages/transform/scripts/run_dbt.py deploy

# 個別実行
python packages/transform/scripts/run_dbt.py compile  # SQLバリデーションのみ
python packages/transform/scripts/run_dbt.py run      # モデル実行
python packages/transform/scripts/run_dbt.py test     # テスト実行
```

参照: [run_dbt.py](../../../../packages/transform/scripts/run_dbt.py)

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

<details>
<summary>廃案: JSON DSL設計（参考）</summary>

当初検討していたJSONB形式の設計。dbtモデル方式に移行したため廃止。

```typescript
interface TimeIntent {
  id: string;
  filter: { personal_category?: string; project?: string; tags?: string[] };
  measure: { type: "total" | "days" | "streak" | "average" | "timing" | ... };
  standard: { value?: number; operation?: "gte" | "lte" };
  scope: { start: Date; end: Date };
}
```

独自DSLの開発・保守コストが高く、dbtで同等以上の機能が得られるため採用しなかった。

</details>

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
