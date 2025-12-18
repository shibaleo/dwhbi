---
title: 時間フロー行列の設計
description: target-actual間の時間の流れやすさを推定するフロー行列の設計
---

# 時間フロー行列の設計

カテゴリ間で「時間がどのように流れやすいか」を表すフロー行列の推定設計。

## 概要

### 目的

target（計画）からactual（実績）への乖離パターンを分析し、カテゴリ間の時間の流れやすさを定量化する。

### アプローチ

観測された (target, actual) ペアから、時間のフローを直接推定する:

```
各日について:
  delta = actual - target
  source = delta < 0 のカテゴリ（時間が流出）
  sink = delta > 0 のカテゴリ（時間が流入）

  最適輸送で source → sink のフローを計算

全日を集計 → フロー行列 F[i,j]
```

**F[i,j]** = カテゴリ i から j へ流れた累計時間（seconds）

### コスト行列への変換

フロー行列からWasserstein距離用のコスト行列を導出:

```
C[i,j] = 1 - F[i,j] / max(F)
```

- 頻繁な遷移 → 低コスト（流れやすい）
- 稀な遷移 → 高コスト（流れにくい）

## データソース

### カテゴリマスタ

DBから動的に取得（ハードコードしない）:

```sql
SELECT name, coarse_category
FROM ref.dim_category_time_personal
ORDER BY sort_order
```

### target-actual ペア

dbt モデル `analysis.daily_category_hours_paired` を使用:

| テーブル | 用途 |
|----------|------|
| `daily_category_hours_actual` | 実績を日次×カテゴリでピボット |
| `daily_category_hours_target_template` | 平日/休日テンプレート |
| `daily_category_hours_paired` | actual と target を day_type で JOIN |

### データ前提

- actual: 計測漏れなし（dbtテスト済み、合計24時間）
- target: 合計24時間

## アルゴリズム

### 1. 差分の計算

```python
delta = actual - target  # 各カテゴリの差分
source = np.maximum(-delta, 0)  # 流出量（正の値）
sink = np.maximum(delta, 0)     # 流入量（正の値）
```

### 2. エントロピー正則化付き最適輸送

source と sink を満たすフロー F を、エントロピー最大化で一意に求める:

```
max  -Σᵢⱼ Fᵢⱼ log(Fᵢⱼ)  （エントロピー最大化）

s.t.
  Σⱼ Fᵢⱼ = sourceᵢ  (供給制約)
  Σᵢ Fᵢⱼ = sinkⱼ    (需要制約)
  Fᵢⱼ ≥ 0
```

#### なぜエントロピー正則化か

単純な実行可能解を求める場合、解が一意に定まらない（複数の最適解が存在）。
エントロピー正則化により:

- **一意性を保証**: 凸最適化問題となり、唯一の最適解が存在
- **最大エントロピー原理**: 情報がない場合、フローは可能な限り均等に分散
- **解釈**: 「特別な理由がなければ、時間はどのカテゴリにも均等に流れうる」

#### Sinkhorn アルゴリズム

エントロピー正則化問題は Sinkhorn アルゴリズムで効率的に解ける:

```python
def sinkhorn(source: np.ndarray, sink: np.ndarray, eps: float = 1.0, max_iter: int = 100) -> np.ndarray:
    """エントロピー正則化付き最適輸送（一様コスト）"""
    n_source, n_sink = len(source), len(sink)

    # 一様コスト → 初期カーネルは全て1
    K = np.ones((n_source, n_sink))

    # スケーリングベクトル
    u = np.ones(n_source)
    v = np.ones(n_sink)

    for _ in range(max_iter):
        u = source / (K @ v)
        v = sink / (K.T @ u)

    # フロー行列
    F = np.diag(u) @ K @ np.diag(v)
    return F
```

注: コスト行列が一様なので、正則化強度 `eps` は解に影響しない（マージナル制約のみで決まる）。

### 3. 全日の集計

```python
total_flow = Σ_days flow_d
```

## 出力

### フロー行列 (Flow Matrix)

F[i,j] = カテゴリ i から j への累計フロー（hours）

解釈:
- F[Work, Pleasure] = 100 → 700日間で計100時間が Work から Pleasure に流れた
- 行和 = そのカテゴリからの総流出量
- 列和 = そのカテゴリへの総流入量

### コスト行列 (Cost Matrix)

C[i,j] = 1 - F[i,j] / max(F)

Wasserstein距離の計算に使用。

### 遷移確率行列 (Transition Probability)

P[i,j] = F[i,j] / Σⱼ F[i,j]

解釈: カテゴリ i から時間が流出するとき、j に流れる確率

## 実装

### ディレクトリ構成

```
packages/
├── analyzer/
│   └── src/analyzer/
│       └── estimate_cost_matrix.py
└── transform/
    ├── models/analysis/
    │   ├── daily_category_hours_actual.sql
    │   ├── daily_category_hours_target_template.sql
    │   └── daily_category_hours_paired.sql
    └── seeds/
        └── cost_matrix_time_categories.csv
```

### 依存関係

```toml
# pyproject.toml
dependencies = [
    "pandas>=2.0.0",
    "scipy>=1.11.0",
    "matplotlib>=3.8.0",
    "seaborn>=0.13.0",
    "psycopg2-binary>=2.9.0",
    "python-dotenv>=1.0.0",
]
```

POT は不要（scipy.optimize.linprog で十分）。

### 実行手順

```bash
# 1. dbt モデルの実行
cd packages/transform
dbt run --select analysis.*

# 2. フロー行列推定
cd packages/analyzer
PYTHONPATH=src .venv/Scripts/python -m analyzer.estimate_cost_matrix
```

### 出力ファイル

| ファイル | 内容 |
|----------|------|
| `seeds/cost_matrix_time_categories.csv` | コスト行列（seed） |
| `output/flow_matrix_heatmap.png` | フロー行列とコスト行列の可視化 |

## 今後の拡張

1. **日次 Wasserstein 距離計算**: 推定済みコスト行列を使って各日の距離を計算
2. **Grafana ダッシュボード**: 計画精度の時系列モニタリング
3. **計画テンプレート改善**: フロー行列から「流れやすい」遷移を特定し、計画に反映
