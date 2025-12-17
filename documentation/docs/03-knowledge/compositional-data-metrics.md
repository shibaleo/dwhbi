---
title: 組成データの距離指標
description: 時間配分のような組成データにおけるtarget-actual比較の指標設計
---

# 組成データの距離指標

一日の時間配分（24時間固定）のような**組成データ (Compositional Data)** において、target（計画）と actual（実績）の乖離を評価する指標の設計ナレッジ。

## 背景・課題

時間配分データの特性:
- 合計が固定値（24時間）に制約される
- あるカテゴリが増えれば、他が減る（完全従属）
- 通常の統計手法（共分散行列など）は特異行列になり適用不可

## 検討した指標

### スケール依存指標

| 指標 | 定義 | 評価 |
|------|------|------|
| MAE | `Σ\|actual - target\| / n` | 合計制約を考慮しない |
| RMSE | `√(Σ(actual - target)² / n)` | 同上 |

### パーセント誤差系

| 指標 | 定義 | 評価 |
|------|------|------|
| MAPE | `Σ\|actual - target\| / actual / n` | target=0で破綻 |
| sMAPE | `Σ\|A - T\| / (\|A\| + \|T\|) × 2 / n` | 対称的だが批判あり |

### スケール不変指標

| 指標 | 定義 | 評価 |
|------|------|------|
| Theil's U | `RMSE / (RMS_A + RMS_T)` | 経済予測で標準 |
| MASE | `MAE / naive_MAE` | 時系列向け |
| R² | `1 - SS_res / SS_tot` | 合計制約を考慮しない |

### 多変量指標

| 指標 | 定義 | 評価 |
|------|------|------|
| Mahalanobis距離 | `√((x-μ)ᵀΣ⁻¹(x-μ))` | 合計制約で共分散行列が特異に |

### 組成データ専用指標

| 指標 | 定義 | 評価 |
|------|------|------|
| Aitchison距離 | `√(Σ(log(xᵢ/g(x)) - log(yᵢ/g(y)))²)` | 組成データ分析の標準 |
| Bray-Curtis | `Σ\|actual - target\| / Σ(actual + target)` | 生態学で使用、シンプル |

### 確率分布間の距離

| 指標 | 定義 | 評価 |
|------|------|------|
| JSD | `(KL(P\|\|M) + KL(Q\|\|M)) / 2` | 情報理論的、カテゴリ間距離を考慮しない |
| Wasserstein距離 | `min Σ Tᵢⱼ × d(i,j)` | カテゴリ間の移動コストを考慮 |
| Sliced Wasserstein | 1次元投影の平均 | 高次元で高速だがk<20なら不要 |

## 採用指標: Wasserstein距離 (Earth Mover's Distance)

### 選定理由

1. **合計制約の適切な扱い**: 組成データを確率分布とみなし比較
2. **カテゴリ間距離の考慮**: 「仕事→趣味」と「仕事→睡眠」を区別できる
3. **解釈性**: 「実績を計画に一致させるには、カテゴリ間で何時間を移動させる必要があるか」という直感的意味
4. **理論的背景**: 最適輸送理論に基づく確立された指標

### 計算方法

```
W(P, Q) = min Σᵢⱼ Tᵢⱼ × Cᵢⱼ

subject to:
  Σⱼ Tᵢⱼ = Pᵢ  (supply制約)
  Σᵢ Tᵢⱼ = Qⱼ  (demand制約)
  Tᵢⱼ ≥ 0

where:
  P = target分布 (各カテゴリのtarget時間 / 24)
  Q = actual分布 (各カテゴリのactual時間 / 24)
  C = コスト行列 (カテゴリ間の移動コスト)
  T = 輸送計画 (最適化で求める)
```

### 計算量

| 手法 | 計算量 | 用途 |
|------|--------|------|
| 線形計画法 | O(k³) | k < 20 で実用的 |
| Sinkhorn | O(k² / ε²) | 近似、微分可能 |
| Sliced | O(n × k log k) | k > 100 向け |

本ケース（k=10）では線形計画法で十分。

## コスト行列の設計

Wasserstein距離にはカテゴリ間のコスト行列 C が必要。

### 非対称コスト行列の必要性

時間配分の変動には方向性がある:

| 遷移 | 難易度 | 理由 |
|------|--------|------|
| 自由時間 → 仕事 | 容易 | 仕事が入れば自由時間は自然に削られる |
| 仕事 → 自由時間 | 困難 | 意志力が必要 |
| 睡眠 → 自由時間 | 短期容易/長期困難 | 睡眠負債になる |
| 自由時間 → 睡眠 | 中程度 | 意識的に早寝する必要 |

→ **コスト行列は非対称** (`C[i,j] ≠ C[j,i]`) であるべき

### 設計アプローチ

| 方法 | 説明 | 適用場面 |
|------|------|----------|
| 手動定義 | ドメイン知識で直接指定 | カテゴリ数が少ない場合 |
| 階層構造 | カテゴリ木の経路長 | 明確な分類体系がある場合 |
| 埋め込み | 特徴ベクトル間のユークリッド距離 | 属性で表現できる場合 |
| データ駆動 | 過去データから学習 | 十分なデータがある場合 |

### 採用: 逆最適輸送によるデータ駆動推定

#### 逆最適輸送 (Inverse Optimal Transport) とは

観測された (target, actual) ペアから、それを最もよく説明するコスト行列を逆推定する手法。

```
入力: 多数の (target, actual) ペア
出力: コスト行列 C

argmin_C Σ_days || T_optimal(C) - T_observed ||²
```

#### 学術的背景

主に**機械学習・応用数学の境界領域**で研究されている:

| 論文 | 分野 | 内容 |
|------|------|------|
| Cuturi (2013) "Sinkhorn Distances" | ML/NeurIPS | 計算効率化の基礎 |
| Peyré & Cuturi (2019) "Computational OT" | 応用数学 | 包括的サーベイ |
| Dupuy & Galichon (2014) | 経済学 | マッチング市場での逆問題 |
| Li et al. (2019) "Learning Cost" | ML/ICML | ニューラルネットでコスト学習 |

#### 本プロジェクトでのデータ状況

| データ | 量 | 備考 |
|--------|-----|------|
| 実績 (actual) | 約700日分 | `fct_time_records_actual` |
| 計画 (target) | 30日分、2パターン | `fct_time_records_target` |

#### 遡及的な計画値割り当て

計画テンプレートが2種類（平日/休日）しかないため、過去700日分の実績に対して曜日ベースで遡及的に計画値を割り当てる:

```
700日分の実績データ
  ↓
曜日で分類
  ↓
平日 → 平日計画テンプレート
休日 → 休日計画テンプレート
  ↓
700組の (target, actual) ペア完成
  ↓
逆最適輸送でコスト行列を推定
```

#### 2パターンのみの計画での限界と有用性

**学習できること**:
- 「平日計画からのずれ方」のパターン
- 「休日計画からのずれ方」のパターン
- カテゴリ間の「流れやすさ」の非対称性

**学習しにくいこと**:
- 中間パターン（例: 仕事=4時間の半休日）でのずれ方

**目的適合性**:
本指標の目的は「計画の精度を上げる」ことであり、現状の2パターンでどこにギャップがあるかを可視化し、計画テンプレートの改善に活かすには十分。

#### コスト行列推定の理論的整理

**理論と計算の区別**:

| 層 | 内容 |
|----|------|
| 純粋数学 | 最適輸送計画 T* とコスト行列 C の関係の理論的性質（存在、一意性、双対性） |
| 逆問題 | 観測 (P, Q, T_obs) から C を復元できるか？（可識別性の問題） |
| 計算 | 実際にどうやって C を推定するか（最適化アルゴリズム） |

**一意性の問題**:

```
C と C' = αC + β (α > 0, β: 任意の定数) は同じ最適輸送計画を与える

→ C 自体は一意に定まらない
→ しかし「相対的なコスト構造」は復元可能
```

対処法:
- 対角成分を 0 に固定: `C[i,i] = 0`
- 最大値を 1 に正規化: `C_normalized = C / max(C)`
- またはフロベニウスノルムで制約: `||C||_F = 1`

**計算方法**:

コスト行列 C の各要素に閉形式の公式は存在しない。数値最適化により**近似的に**求める。

**理論的保証と計算の限界**:

| 保証されること | 保証されないこと |
|----------------|------------------|
| 最適輸送計画 T* の存在 | 観測 (P, Q) のみから T_obs を復元すること |
| T_obs から C の同値類（アファイン変換で同一視）の特定 | 有限サンプルでの推定誤差の制御 |
| | 数値最適化における大域的最適性 |

**数値計算に含まれるヒューリスティック**:

1. 初期値の選択（恣意的）
2. 最適化アルゴリズム（局所解に収束、大域解の保証なし）
3. 正則化パラメータ λ の選択（恣意的）
4. 有限回反復での打ち切り

#### 初期値としての階層構造の活用

最適化は局所解に収束するため、初期値の選択が結果に影響する。カテゴリの階層構造（coarse_category）を事前知識として初期値に反映させることで、より妥当な解に収束しやすくなる。

**カテゴリ階層**:

| coarse_category | カテゴリ |
|-----------------|----------|
| Essentials | Vitals, Sleep, Exercise |
| Obligation | Overhead, Work, Education |
| Leisure | Creative, Social, Meta, Pleasure |

**階層ベースの初期値**:

```python
def build_initial_cost_matrix(categories, groups, same_group_cost=1.0, diff_group_cost=2.0):
    """
    階層構造を反映した初期コスト行列を生成
    同グループ内は低コスト、異グループ間は高コスト
    """
    k = len(categories)
    C = np.zeros((k, k))
    for i in range(k):
        for j in range(k):
            if i == j:
                C[i, j] = 0
            elif groups[i] == groups[j]:
                C[i, j] = same_group_cost
            else:
                C[i, j] = diff_group_cost
    return C
```

**期待される効果**:

| 初期値 | 特徴 |
|--------|------|
| 一様 (`ones`) | 事前知識なし、収束が遅い可能性 |
| 階層ベース | 「同グループ内は流れやすい」という事前知識を反映 |

階層構造は推定結果の検証にも有用（推定された C が階層と整合的か確認できる）。

| 方法 | 概要 | ニューラルネットワーク |
|------|------|------------------------|
| 双対問題の最適化 | KKT条件から C を逆算 | 不要 |
| Sinkhorn + 勾配法 | 微分可能なので勾配降下 | 不要 |
| 最尤推定 | 統計モデルとしてフィッティング | 不要 |
| NN でパラメタライズ | 高次元・複雑な構造向け | 必要 |

k=10 程度では古典的な数値最適化（scipy.optimize 等）で十分であり、ニューラルネットワークは不要。

**最適化問題の定式化**:

```python
import numpy as np
from scipy.optimize import minimize
import ot

def estimate_cost_matrix(samples: list, k: int, reg: float = 0.1):
    """
    samples: [(target_i, actual_i), ...] のリスト
    k: カテゴリ数
    reg: 正則化パラメータ
    """
    def objective(C_flat):
        C = C_flat.reshape(k, k)
        np.fill_diagonal(C, 0)  # 対角成分は 0 に固定

        loss = 0
        for target, actual in samples:
            p = target / target.sum()
            q = actual / actual.sum()
            loss += ot.emd2(p, q, C)

        # 正則化（自明解 C=0 を回避）
        loss += reg * np.sum(C ** 2)
        return loss

    # 初期値: 一様コスト
    C_init = np.ones((k, k)) - np.eye(k)

    result = minimize(
        objective,
        C_init.flatten(),
        method='L-BFGS-B',
        bounds=[(0, None)] * (k * k)  # C_ij >= 0
    )

    C_optimal = result.x.reshape(k, k)
    # 正規化
    C_optimal = C_optimal / C_optimal.max()
    np.fill_diagonal(C_optimal, 0)

    return C_optimal
```

## 実装方針

### 使用ライブラリ

| ライブラリ | 用途 | 選定理由 |
|------------|------|----------|
| **POT** | Wasserstein距離の計算 (`ot.emd2`) | 最適輸送の標準ライブラリ |
| **scipy.optimize** | コスト行列の推定 (`minimize`) | 汎用最適化、L-BFGS-B |
| **numpy** | 行列演算 | 標準 |

**逆問題（コスト行列推定）について**: どのライブラリも逆問題を直接解く機能は提供していない。POT で順問題を解きつつ、scipy.optimize で目的関数を最小化するループを自前で実装する（約30行程度）。

k=10、700サンプル程度であれば CPU で数秒〜数十秒で収束するため、GPU対応ライブラリ（OTT-JAX, GeomLoss）は不要。

### データソース

時系列エントリではなく、**日次で集計された** カテゴリ別時間配分を使用する。

| テーブル | 用途 | 備考 |
|----------|------|------|
| `fct_time_records_actual_split` | 実績データ | JST 00:00で日分割済み |
| `fct_time_records_target_split` | 計画テンプレート | 平日/休日の2パターンのみ |

**target データの扱い**:

`fct_time_records_target_split` には平日・休日の2パターンのテンプレートしか存在しない。actual の各日に対応する target を得るには、曜日に基づいてテンプレートをサンプリングする必要がある。

```
actual の日付リスト (約700日)
  ↓
曜日を判定 (月-金 → 平日, 土日 → 休日)
  ↓
対応するテンプレートを JOIN
  ↓
(target, actual) ペアの完成
```

**データ形式**:

```
入力: 各日の時系列エントリ（複数行）
  ↓
日次・カテゴリ別に集計
  ↓
出力: 各日 × 10カテゴリの時間ベクトル（1行 = 10次元）
```

```sql
-- actual: 日次・カテゴリ別の時間集計
SELECT
    (start_at AT TIME ZONE 'Asia/Tokyo')::date AS date,
    personal_category,
    SUM(duration_seconds) / 3600.0 AS hours
FROM fct_time_records_actual_split
GROUP BY 1, 2

-- target: テンプレートから曜日ベースでサンプリング
-- 平日テンプレート: 特定の平日の日付でフィルタ
-- 休日テンプレート: 特定の休日の日付でフィルタ
```

### 実装ステップ

1. **日次カテゴリ別集計モデルを作成** (dbt SQL)
   - actual: `fct_time_records_actual_split` → 日次×カテゴリ集計
   - target: `fct_time_records_target_split` → 日次×カテゴリ集計（平日/休日テンプレート）

2. **遡及的な target 割り当て** (dbt SQL)
   - 過去の actual 日付に対して曜日ベースで平日/休日テンプレートを JOIN

3. **コスト行列推定スクリプト** (Python, 一度だけ実行)
   - 700日分の (target, actual) ペアから C を推定
   - 結果を seed (CSV) として保存

4. **日次 Wasserstein 距離計算** (dbt Python model)
   - 推定済み C を使って各日の距離を計算
   - Grafana でモニタリング

### Python コード

```python
import ot
import numpy as np

def calculate_wasserstein(target: np.ndarray, actual: np.ndarray, cost_matrix: np.ndarray) -> float:
    """
    target, actual: 各カテゴリの時間（合計24）
    cost_matrix: k×k のコスト行列
    """
    # 確率分布に正規化
    p = target / target.sum()
    q = actual / actual.sum()

    # Wasserstein距離（EMD）を計算
    return ot.emd2(p, q, cost_matrix)
```

## 詳細実装設計

### ディレクトリ構成

```
packages/
├── analyzer/
│   ├── pyproject.toml
│   ├── .venv/                    # Python 3.12+ (POTのwheelあり)
│   ├── output/
│   │   └── cost_matrix_heatmap.png
│   └── src/analyzer/
│       └── estimate_cost_matrix.py
└── transform/
    ├── models/analysis/
    │   ├── daily_category_hours_actual.sql
    │   ├── daily_category_hours_target_template.sql
    │   └── daily_category_hours_paired.sql
    └── seeds/
        └── cost_matrix_time_categories.csv  # 推定結果
```

### dbt モデル

#### 1. daily_category_hours_actual.sql

実績データを日次×カテゴリでピボットする。

```sql
-- analysis.daily_category_hours_actual
with source as (
    select
        (start_at at time zone 'Asia/Tokyo')::date as date,
        personal_category,
        sum(duration_seconds) / 3600.0 as hours
    from {{ ref('fct_time_records_actual_split') }}
    group by 1, 2
),

-- 全日付×全カテゴリの組み合わせを生成（欠損カテゴリは0時間）
dates as (select distinct date from source),
categories as (
    select name from {{ ref('dim_category_time_personal') }}
),
filled as (
    select
        d.date,
        c.name as personal_category,
        coalesce(s.hours, 0) as hours
    from dates d
    cross join categories c
    left join source s on d.date = s.date and c.name = s.personal_category
)

select
    date,
    extract(dow from date)::integer as day_of_week,
    case when extract(dow from date) in (0, 6) then 'holiday' else 'weekday' end as day_type,
    -- ピボット (10カテゴリ)
    max(case when personal_category = 'Vitals' then hours else 0 end) as vitals_hours,
    max(case when personal_category = 'Sleep' then hours else 0 end) as sleep_hours,
    max(case when personal_category = 'Exercise' then hours else 0 end) as exercise_hours,
    max(case when personal_category = 'Overhead' then hours else 0 end) as overhead_hours,
    max(case when personal_category = 'Work' then hours else 0 end) as work_hours,
    max(case when personal_category = 'Education' then hours else 0 end) as education_hours,
    max(case when personal_category = 'Creative' then hours else 0 end) as creative_hours,
    max(case when personal_category = 'Social' then hours else 0 end) as social_hours,
    max(case when personal_category = 'Meta' then hours else 0 end) as meta_hours,
    max(case when personal_category = 'Pleasure' then hours else 0 end) as pleasure_hours,
    sum(hours) as total_hours
from filled
group by date
order by date
```

#### 2. daily_category_hours_target_template.sql

平日/休日テンプレートを抽出する。

**注意**: `fct_time_records_target_split` には複数日のデータがあるが、実質的に平日/休日の2パターン。不完全な日（合計20時間未満）を除外する。

```sql
-- analysis.daily_category_hours_target_template
with daily_agg as (
    select
        (start_at at time zone 'Asia/Tokyo')::date as date,
        personal_category,
        sum(duration_seconds) / 3600.0 as hours
    from {{ ref('fct_time_records_target_split') }}
    group by 1, 2
),

daily_totals as (
    select date, sum(hours) as total_hours
    from daily_agg
    group by date
    having sum(hours) >= 20  -- 不完全な日を除外
),

dates_with_type as (
    select distinct
        d.date,
        case when extract(dow from d.date) in (0, 6) then 'holiday' else 'weekday' end as day_type
    from daily_totals d
),

representative_dates as (
    select day_type, min(date) as sample_date
    from dates_with_type
    group by day_type
),

-- 以下、ピボット処理 (actual と同様)
...
```

#### 3. daily_category_hours_paired.sql

actual と target テンプレートを day_type で JOIN。

```sql
-- analysis.daily_category_hours_paired
with actual as (
    select * from {{ ref('daily_category_hours_actual') }}
),
target_template as (
    select * from {{ ref('daily_category_hours_target_template') }}
)

select
    a.date,
    a.day_of_week,
    a.day_type,
    -- Actual (10列)
    a.vitals_hours as actual_vitals,
    a.sleep_hours as actual_sleep,
    ...
    -- Target (10列)
    t.vitals_hours as target_vitals,
    t.sleep_hours as target_sleep,
    ...
from actual a
join target_template t on a.day_type = t.day_type
order by a.date
```

### Python スクリプト

#### estimate_cost_matrix.py

**ファイル**: `packages/analyzer/src/analyzer/estimate_cost_matrix.py`

**依存関係** (pyproject.toml):
```toml
dependencies = [
    "pandas>=2.0.0",
    "scipy>=1.11.0",
    "matplotlib>=3.8.0",
    "seaborn>=0.13.0",
    "sqlalchemy>=2.0.0",        # pandas.read_sql に必要
    "psycopg2-binary>=2.9.0",   # SQLAlchemy の PostgreSQL ドライバ
    "python-dotenv>=1.0.0",
]
```

**注意**:
- POT (Python Optimal Transport) は Python 3.14 ではビルドに失敗する（Visual C++ 必要）
- Python 3.12 では pre-built wheel が利用可能
- 代替: scipy.optimize.linprog による純粋実装でも可能（本スクリプトに含まれる）

#### 主要関数

```python
def emd(p: np.ndarray, q: np.ndarray, C: np.ndarray) -> float:
    """scipy.optimize.linprog を使った EMD 計算（POT不要）"""
    n, m = len(p), len(q)
    c = C.flatten()

    # 制約行列の構築
    A_eq = np.zeros((n + m, n * m))
    for i in range(n):
        A_eq[i, i * m : (i + 1) * m] = 1  # 供給制約
    for j in range(m):
        for i in range(n):
            A_eq[n + j, i * m + j] = 1    # 需要制約
    b_eq = np.concatenate([p, q])

    result = linprog(c, A_eq=A_eq, b_eq=b_eq, bounds=(0, None), method="highs")
    return float(result.fun) if result.success else float("inf")


def load_paired_data() -> pd.DataFrame:
    """PostgreSQL から SQLAlchemy 経由でデータ取得"""
    database_url = os.getenv("DIRECT_DATABASE_URL")
    # postgresql:// → postgresql+psycopg2:// に変換
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)

    engine = create_engine(database_url)
    df = pd.read_sql("SELECT * FROM analysis.daily_category_hours_paired", engine)
    engine.dispose()
    return df


def estimate_cost_matrix(
    samples: list[tuple[np.ndarray, np.ndarray]],
    C_init: np.ndarray,
    reg: float = 0.1,
    max_samples: int = 100,  # 計算量削減
    max_iter: int = 100,
) -> np.ndarray:
    """逆最適輸送によるコスト行列推定"""
    k = len(C_init)

    # サンプル数が多い場合はランダムサブサンプリング
    if len(samples) > max_samples:
        np.random.seed(42)
        indices = np.random.choice(len(samples), max_samples, replace=False)
        samples = [samples[i] for i in indices]

    def objective(C_flat: np.ndarray) -> float:
        C = C_flat.reshape(k, k)
        np.fill_diagonal(C, 0)

        loss = sum(emd(t / t.sum(), a / a.sum(), C) for t, a in samples)
        loss += reg * np.sum(C**2)  # L2正則化
        return loss

    result = minimize(
        objective,
        C_init.flatten(),
        method="L-BFGS-B",
        bounds=[(0, None)] * (k * k),
        options={"maxiter": max_iter},
    )

    C_optimal = result.x.reshape(k, k)
    C_optimal = C_optimal / C_optimal.max()  # 正規化
    np.fill_diagonal(C_optimal, 0)
    return C_optimal
```

#### 計算量の問題と対策

**問題**:
- 1回の目的関数評価で N 回の EMD（線形計画）を解く
- L-BFGS-B は勾配近似のため、1イテレーションで複数回の関数評価
- N=763, k=10, maxiter=1000 だと実用時間を超える

**対策**:
1. **サンプル数の削減**: `max_samples=100` でランダムサブサンプリング
2. **イテレーション数の削減**: `max_iter=100`
3. **初期値の工夫**: 階層構造ベースの初期値で収束を高速化

```python
COARSE_GROUPS = {
    "Vitals": "Essentials", "Sleep": "Essentials", "Exercise": "Essentials",
    "Overhead": "Obligation", "Work": "Obligation", "Education": "Obligation",
    "Creative": "Leisure", "Social": "Leisure", "Meta": "Leisure", "Pleasure": "Leisure",
}

def build_initial_cost_matrix(categories, groups, same_group_cost=1.0, diff_group_cost=2.0):
    k = len(categories)
    C = np.zeros((k, k))
    for i, cat_i in enumerate(categories):
        for j, cat_j in enumerate(categories):
            if i == j:
                C[i, j] = 0
            elif groups[cat_i] == groups[cat_j]:
                C[i, j] = same_group_cost
            else:
                C[i, j] = diff_group_cost
    return C
```

### 実行手順

```bash
# 1. dbt モデルの実行
cd packages/transform
python scripts/run_dbt.py run --select analysis.*

# 2. Python 環境のセットアップ (Python 3.12 推奨)
cd packages/analyzer
python -m venv .venv
.venv/Scripts/pip install pandas scipy matplotlib seaborn sqlalchemy psycopg2-binary python-dotenv

# 3. コスト行列推定の実行
PYTHONPATH=src .venv/Scripts/python -m analyzer.estimate_cost_matrix
```

### 出力

1. **CSV seed**: `packages/transform/seeds/cost_matrix_time_categories.csv`
   ```csv
   from_category,to_category,cost
   Vitals,Sleep,0.15
   Vitals,Exercise,0.20
   ...
   ```

2. **ヒートマップ**: `packages/analyzer/output/cost_matrix_heatmap.png`

### 今後の拡張

1. **Wasserstein 距離の日次計算**: dbt Python model で推定済みコスト行列を使用
2. **Grafana ダッシュボード**: 計画精度の時系列モニタリング
3. **計画テンプレートの改善**: コスト行列から「流れやすい」遷移を特定し、計画に反映

## 参考文献

- Villani, C. (2008). *Optimal Transport: Old and New*
- Peyré, G., & Cuturi, M. (2019). *Computational Optimal Transport*
- Aitchison, J. (1986). *The Statistical Analysis of Compositional Data*
