---
title: 001 推定値計算ロジック
description: actual から estimate を計算するアルゴリズム
---

# 推定値計算ロジック

## 概要

ADR-003 のフィードバックループにおける「analysis」プラクティス。
actual（実績）から estimate（推定）を導出する計算ロジック。

## 目的

過去の実績データを分析し、将来の時間配分を予測する。

## 実装方針

推定アルゴリズムは **`analyzer/` Python プロジェクト**で実装する。
LightGBM による時系列予測を採用し、staging/core 層を入力、core 層に出力する。

### プロジェクト構成

```
analyzer/
├── pyproject.toml              # uv/poetry、LightGBM 等の依存関係
├── README.md
├── src/
│   └── analyzer/
│       ├── __init__.py
│       ├── common/             # 共通ユーティリティ
│       │   ├── __init__.py
│       │   ├── db.py           # Supabase接続（analyzer読み取り、core書き込み）
│       │   └── config.py       # 環境設定
│       └── time/               # 時間ドメイン
│           ├── __init__.py
│           ├── models/         # MLモデル定義
│           │   ├── __init__.py
│           │   └── estimate.py # LightGBM時系列予測
│           ├── features/       # 特徴量エンジニアリング
│           │   ├── __init__.py
│           │   └── builder.py  # 特徴量生成
│           └── runner.py       # 実行エントリ
├── transform/                  # analyzer 用 dbt（必要に応じて）
│   ├── dbt_project.yml
│   ├── models/
│   │   └── analyzer/           # analyzer スキーマに出力
│   └── seeds/                  # analyzer 用マスタ
├── notebooks/                  # 実験・分析用Jupyter
│   └── time/
├── tests/
│   └── time/
└── scripts/
    └── run_estimate.py         # CLIエントリーポイント
```

### データフロー

```
[Input]                              [Process]              [Output]
staging.stg_toggl_track__*  ─┐
core.dim_day_types          ─┼─→ analyzer/time ─────────→ core.fct_time_daily_estimate
seeds.mst_*                 ─┘    (LightGBM)                  (JSONB スナップショット)
                                       │
                                       ↓
                              analyzer.* (中間テーブル/ビュー)
```

### スキーマ構成

```
raw       ← 外部 API 生データ（自動同期）
staging   ← クリーニング済み（dbt ビュー）
core      ← 最終出力（actual, estimate, plan）
console   ← ユーザー操作データ（target: SCD Type 2）
analyzer  ← 分析過程の中間テーブル・ビュー
seeds     ← マスタデータ（CSV）
marts     ← 分析・可視化用（将来）
```

### 他プロジェクトとの役割分担

| プロジェクト | 役割 | 技術 | 出力スキーマ |
|-------------|------|------|-------------|
| `pipelines/` | Extract/Load（データ取得） | Python + API | raw |
| `transform/` | Transform（データ変換） | dbt | staging, core, marts |
| `analyzer/` | ML分析 | Python + LightGBM + dbt | analyzer → core |

### 将来のドメイン拡張

```
analyzer/
├── common/         # 共通（DB接続、設定）
├── time/           # 時間ドメイン ← 今回実装
├── finance/        # 金銭ドメイン（将来: Zaim）
└── health/         # 健康ドメイン（将来: Fitbit/Tanita）
```

## 関数インターフェース

### 入力（Input）

| パラメータ | 型 | 説明 |
|------------|-----|------|
| target_date | DATE | 推定対象の日付（YYYY-MM-DD） |
| v_time_records_actual | View | 実績レコードビュー |
| v_time_records_plan | View | 計画レコードビュー |
| v_time_records_unified | View | 統合レコードビュー |
| dim_day_types | View | 日タイプビュー |

### 出力（Output）

```json
{
  "date": "2025-12-07",
  "estimate": {
    "Sleep": 420,
    "Work": 480,
    "Education": 180,
    "Leisure": 60
  },
  "meta": {
    "calculated_at": "2025-12-07T15:00:00Z",
    "calculation_method": "daytype_pattern_v3",
    "lookback_days": 30
  }
}
```

| フィールド | 型 | 説明 |
|------------|-----|------|
| date | string | 推定対象日（YYYY-MM-DD） |
| estimate | object | カテゴリ名 → 推定時間（分）のマップ |
| meta.calculated_at | timestamp | 計算実行時刻 |
| meta.calculation_method | string | 使用したアルゴリズム識別子 |
| meta.lookback_days | integer | 参照した過去日数（任意） |

※ estimate のプロパティ名は `mst_time_personal_categories.name` に一致させる

## データソース

Python スクリプトがアクセス可能なビュー:

- `core.v_time_records_actual`: 日別カテゴリ別の実績時間
- `core.v_time_records_plan`: 計画レコード
- `core.v_time_records_unified`: actual/plan 統合ビュー
- `core.dim_day_types`: 日タイプ情報

## 出力先

- `core.fct_time_daily_estimate`: JSONB 形式の推定値

## アルゴリズム（Python 実装）

アルゴリズムは `analyzer/time` で実装する。**LightGBM** を主要モデルとして採用。

### 採用モデル: LightGBM

時系列予測に LightGBM を採用する理由:

| 観点 | LightGBM | Prophet | ARIMA |
|------|----------|---------|-------|
| 特徴量の柔軟性 | ◎ 任意の特徴量 | △ リグレッサ限定 | × |
| day_type 対応 | ◎ カテゴリ特徴量 | △ ダミー変数化 | × |
| 学習速度 | ◎ 高速 | △ 中程度 | ○ |
| 解釈性 | ○ feature importance | ◎ 成分分解 | △ |
| 実装難易度 | ○ | ○ | △ |

**結論**: day_type や曜日など複数の特徴量を柔軟に扱える LightGBM を採用。

### LightGBM 実装

```python
import lightgbm as lgb
import pandas as pd
from datetime import date, timedelta

def estimate_lightgbm(
    target_date: date,
    actual_df: pd.DataFrame,
    day_types_df: pd.DataFrame,
    category: str,
    lookback_days: int = 90
) -> dict:
    """
    LightGBM による時系列予測
    """
    # 特徴量生成
    df = actual_df[actual_df['time_category_personal'] == category].copy()
    df = df.merge(day_types_df, on='date_day')

    # 特徴量エンジニアリング
    df['dow'] = pd.to_datetime(df['date_day']).dt.dayofweek
    df['month'] = pd.to_datetime(df['date_day']).dt.month
    df['is_weekend'] = df['dow'].isin([5, 6]).astype(int)

    # day_type をカテゴリカル特徴量として使用
    df['day_type_cat'] = df['day_type'].astype('category')

    # ラグ特徴量
    df['lag_1'] = df['duration_min'].shift(1)
    df['lag_7'] = df['duration_min'].shift(7)
    df['rolling_7_mean'] = df['duration_min'].rolling(7).mean()

    # 学習データ準備
    feature_cols = ['dow', 'month', 'is_weekend', 'day_type_cat',
                    'lag_1', 'lag_7', 'rolling_7_mean']

    train_df = df[df['date_day'] < target_date].dropna()
    X_train = train_df[feature_cols]
    y_train = train_df['duration_min']

    # モデル学習
    model = lgb.LGBMRegressor(
        objective='regression',
        n_estimators=100,
        learning_rate=0.1,
        num_leaves=31,
        random_state=42
    )
    model.fit(X_train, y_train, categorical_feature=['day_type_cat'])

    # 予測用特徴量準備
    target_dow = target_date.weekday()
    target_month = target_date.month
    target_day_type = day_types_df[
        day_types_df['date_day'] == target_date
    ]['day_type'].iloc[0]

    X_pred = pd.DataFrame([{
        'dow': target_dow,
        'month': target_month,
        'is_weekend': 1 if target_dow >= 5 else 0,
        'day_type_cat': target_day_type,
        'lag_1': df['duration_min'].iloc[-1],
        'lag_7': df['duration_min'].iloc[-7] if len(df) >= 7 else None,
        'rolling_7_mean': df['duration_min'].tail(7).mean()
    }])

    # 予測
    prediction = model.predict(X_pred)[0]

    return {
        'category': category,
        'estimate_min': int(max(0, prediction)),
        'feature_importance': dict(zip(feature_cols, model.feature_importances_))
    }
```

### ベースライン比較用（v1〜v3）

以下は LightGBM との精度比較用ベースラインとして残す。

#### v1: 単純移動平均

```python
def estimate_v1_moving_average(
    target_date: date,
    actual_df: pd.DataFrame,
    lookback_days: int = 7
) -> dict:
    """過去N日の平均を計算"""
    start_date = target_date - timedelta(days=lookback_days)
    recent = actual_df[
        (actual_df['date_day'] >= start_date) &
        (actual_df['date_day'] < target_date)
    ]
    estimate = recent.groupby('time_category_personal')['duration_min'].mean().to_dict()
    return {
        "date": target_date.isoformat(),
        "estimate": estimate,
        "meta": {
            "calculated_at": datetime.now(timezone.utc).isoformat(),
            "calculation_method": "moving_average_v1",
            "lookback_days": lookback_days
        }
    }
```

#### v2: 曜日パターン加味

```python
def estimate_v2_dow_pattern(
    target_date: date,
    actual_df: pd.DataFrame,
    lookback_weeks: int = 4
) -> dict:
    """曜日別の傾向を考慮"""
    target_dow = target_date.weekday()
    start_date = target_date - timedelta(weeks=lookback_weeks)

    recent = actual_df[actual_df['date_day'] >= start_date].copy()
    recent['dow'] = pd.to_datetime(recent['date_day']).dt.weekday

    same_dow = recent[recent['dow'] == target_dow]
    estimate = same_dow.groupby('time_category_personal')['duration_min'].mean().to_dict()

    return {
        "date": target_date.isoformat(),
        "estimate": estimate,
        "meta": {
            "calculated_at": datetime.now(timezone.utc).isoformat(),
            "calculation_method": "dow_pattern_v2",
            "lookback_weeks": lookback_weeks
        }
    }
```

#### v3: day_type 別パターン

```python
def estimate_v3_daytype_pattern(
    target_date: date,
    actual_df: pd.DataFrame,
    day_types_df: pd.DataFrame,
    lookback_days: int = 30
) -> dict:
    """day_type（Work/Leisure/Education等）別の傾向"""
    target_day_type = day_types_df[
        day_types_df['date_day'] == target_date
    ]['day_type'].iloc[0]

    start_date = target_date - timedelta(days=lookback_days)

    # actual に day_type を結合
    merged = actual_df.merge(day_types_df, on='date_day')
    recent = merged[
        (merged['date_day'] >= start_date) &
        (merged['day_type'] == target_day_type)
    ]

    estimate = recent.groupby('time_category_personal')['duration_min'].mean().to_dict()

    return {
        "date": target_date.isoformat(),
        "estimate": estimate,
        "meta": {
            "calculated_at": datetime.now(timezone.utc).isoformat(),
            "calculation_method": "daytype_pattern_v3",
            "lookback_days": lookback_days,
            "day_type": target_day_type
        }
    }
```

## 将来拡張: 学習済み時系列予測モデル

データが十分に蓄積された段階で、学習済み時系列予測モデルの導入を検討する。

### 候補フレームワーク

| 名前 | 特徴 | 用途 |
|------|------|------|
| **Prophet** | 週次/年次の季節性を自動検出、祝日対応 | 季節パターンの予測 |
| **NeuralProphet** | Prophet + ニューラルネット | より複雑なパターン |
| **statsforecast** | 高速な古典的手法（ARIMA, ETS等） | ベースライン比較 |
| **darts** | 統一APIで複数モデルを切り替え可能 | モデル比較・選択 |

### Foundation Models（事前学習済みモデル）

ゼロショット/少量データで予測可能な大規模事前学習モデル:

| 名前 | 提供元 | 特徴 |
|------|--------|------|
| **TimesFM** | Google | 汎用時系列予測 |
| **Chronos** | Amazon | T5ベースのトークン化予測 |
| **Lag-Llama** | ServiceNow | LLMベースの時系列予測 |
| **Moirai** | Salesforce | マルチバリエート対応 |

### 推奨構成

**環境**: ローカル GPU (RTX 2060) + Claude Max プラン + Supabase

| 処理 | 手法 | 実行 | 保存先 |
|------|------|------|--------|
| estimate | ローカル ML (Chronos/Prophet) | 日次バッチ（タスクスケジューラ） | Supabase |
| 振り返り + plan | Claude Desktop | 夜の対話セッション | - |

#### ローカル実行を推奨する理由

| 観点 | クラウド API | ローカル GPU |
|------|-------------|-------------|
| 時間予測のみ | $0.10/月 | セットアップ工数 |
| **マルチドメイン**（時間+金銭+健康） | $0.30/月〜 | **同じセットアップ** |
| スケール性 | コスト線形増加 | 固定コスト |
| 柔軟性 | API 仕様に依存 | モデル選択自由 |

将来的に金銭（Zaim）、健康（Fitbit/Tanita）など複数ドメインで予測したい場合、
ローカル環境のほうがスケールしやすい。

#### 運用フロー

```
[日次バッチ（タスクスケジューラ）]
    Toggl Track → Supabase (actual)  ← 既に自動化済み
        ↓
    python estimate_all.py --date tomorrow  ← ローカル実行
        ↓
    Supabase に estimate 保存（JSONB）

[夜の振り返りセッション - Claude Desktop]
    1. PostgreSQL MCP で Supabase 参照
       - actual（今日の実績）
       - estimate（明日の予測）
       - target（明日の目標）
    2. 対話的に plan 作成
    3. Google Calendar MCP で登録
```

**メリット**: マルチドメイン対応、固定コスト、モデル選択の自由度

### 時系列予測 API サービス

| サービス | 特徴 | 料金目安 |
|----------|------|----------|
| **Nixtla TimeGPT** | Foundation Model API、シンプル | 予測1000件 $0.10〜 |
| **Amazon Forecast** | AWS マネージド、AutoML | 予測1000件 $0.60〜 |
| **Google Vertex AI** | GCP マネージド | 予測1000件 $0.30〜 |

**推奨**: Nixtla TimeGPT（シンプル、低コスト、無料枠あり）

#### TimeGPT による estimate 計算

```python
from nixtla import NixtlaClient
import pandas as pd

def calculate_estimate_timegpt(
    target_date: date,
    actual_df: pd.DataFrame,
    categories: list[str]
) -> dict:
    """
    TimeGPT API で estimate を計算し、Supabase に保存
    """
    client = NixtlaClient(api_key=os.environ["NIXTLA_API_KEY"])

    estimates = {}
    for category in categories:
        # カテゴリ別にフィルタ
        cat_df = actual_df[actual_df['category'] == category][['ds', 'y']]

        # 予測
        forecast = client.forecast(
            df=cat_df,
            h=1,  # 1日先
            level=[90]
        )

        estimates[category] = int(forecast['TimeGPT'].iloc[0])

    return {
        "date": target_date.isoformat(),
        "estimate": estimates,
        "meta": {
            "calculated_at": datetime.now(timezone.utc).isoformat(),
            "calculation_method": "timegpt_api"
        }
    }
```

### ローカル GPU（推奨）

RTX 2060（6GB VRAM）で動作可能なモデル:

| モデル | VRAM | 特徴 |
|--------|------|------|
| **Chronos-T5-Small** | ~2GB | Amazon、軽量で高速 |
| **Chronos-T5-Base** | ~4GB | より高精度 |
| **Prophet** | CPU可 | 古典的だが安定 |

### 適用例

```python
# Prophet での day_type をリグレッサとして使用
from prophet import Prophet

def estimate_v4_prophet(
    target_date: date,
    actual_df: pd.DataFrame,
    day_types_df: pd.DataFrame,
    category: str
) -> dict:
    """Prophet による時系列予測"""
    # カテゴリ別にモデルを構築
    cat_data = actual_df[actual_df['time_category_personal'] == category].copy()
    cat_data = cat_data.merge(day_types_df, on='date_day')

    # Prophet 形式に変換
    df = cat_data.rename(columns={'date_day': 'ds', 'duration_min': 'y'})

    # day_type をダミー変数化
    for dt in ['Work', 'Education', 'Leisure', 'Rest']:
        df[f'is_{dt.lower()}'] = (df['day_type'] == dt).astype(int)

    model = Prophet()
    for dt in ['Work', 'Education', 'Leisure', 'Rest']:
        model.add_regressor(f'is_{dt.lower()}')

    model.fit(df)

    # 予測
    future = model.make_future_dataframe(periods=1)
    # ... リグレッサ値を設定
    forecast = model.predict(future)

    return forecast['yhat'].iloc[-1]
```

### 導入条件

- 最低 90 日以上の実績データ
- day_type 別に十分なサンプル数（各 10 日以上）
- v1〜v3 との精度比較で優位性が確認できること

**現状**: 2年以上の実績データ（約12,000レコード）が蓄積済み。
季節性パターンや年間トレンドの分析が可能な状態であり、
Prophet や Foundation Models の導入を積極的に検討できる。

### ML 用ビュー設計

外部ライブラリが使いやすい形式でデータを提供するビューを用意する。

#### v_time_ml_daily（ML用日次集計ビュー）

```sql
-- core.v_time_ml_daily
-- Prophet / statsforecast 等が利用しやすい形式
SELECT
  a.date_day AS ds,                          -- Prophet標準: 日付
  a.time_category_personal AS category,      -- カテゴリ識別
  a.duration_min AS y,                       -- Prophet標準: 目的変数

  -- 曜日特徴量
  EXTRACT(DOW FROM a.date_day) AS dow,       -- 0=日, 6=土
  EXTRACT(ISODOW FROM a.date_day) AS isodow, -- 1=月, 7=日
  CASE WHEN EXTRACT(DOW FROM a.date_day) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,

  -- day_type 特徴量（ダミー変数）
  d.day_type,
  CASE WHEN d.day_type = 'Work' THEN 1 ELSE 0 END AS is_work,
  CASE WHEN d.day_type = 'Education' THEN 1 ELSE 0 END AS is_education,
  CASE WHEN d.day_type = 'Leisure' THEN 1 ELSE 0 END AS is_leisure,
  CASE WHEN d.day_type = 'Rest' THEN 1 ELSE 0 END AS is_rest,

  -- 季節特徴量
  EXTRACT(MONTH FROM a.date_day) AS month,
  EXTRACT(QUARTER FROM a.date_day) AS quarter,
  EXTRACT(WEEK FROM a.date_day) AS week_of_year,
  EXTRACT(DOY FROM a.date_day) AS day_of_year,

  -- 祝日フラグ（将来拡張）
  COALESCE(h.is_holiday, FALSE) AS is_holiday

FROM v_time_daily_actual a
JOIN dim_day_types d ON a.date_day = d.date_day
LEFT JOIN dim_holidays h ON a.date_day = h.date_day  -- 将来追加
```

#### 列説明

| 列名 | 型 | 用途 |
|------|-----|------|
| ds | date | Prophet 標準の日付列 |
| y | integer | Prophet 標準の目的変数（分） |
| category | text | カテゴリ別モデル構築用 |
| dow / isodow | integer | 曜日パターン |
| is_weekend | integer | 週末フラグ |
| is_work / is_education / is_leisure / is_rest | integer | day_type ダミー変数（リグレッサ用） |
| month / quarter | integer | 季節性特徴量 |
| is_holiday | boolean | 祝日フラグ（将来） |

#### 使用例

```python
import pandas as pd
from prophet import Prophet

# DB からデータ取得
df = pd.read_sql("""
    SELECT ds, y, is_work, is_education, is_leisure, is_rest
    FROM core.v_time_ml_daily
    WHERE category = 'Education'
    ORDER BY ds
""", conn)

# Prophet モデル構築
model = Prophet()
model.add_regressor('is_work')
model.add_regressor('is_education')
model.add_regressor('is_leisure')
model.add_regressor('is_rest')
model.fit(df)
```

## 実装ステータス

### analyzer プロジェクト構築
- [ ] `analyzer/` ディレクトリ作成
- [ ] `pyproject.toml` 設定（LightGBM, pandas, psycopg2 等）
- [ ] `src/analyzer/common/db.py` - Supabase 接続
- [ ] `src/analyzer/common/config.py` - 環境設定

### 時間ドメイン実装
- [ ] `src/analyzer/time/features/builder.py` - 特徴量生成
- [ ] `src/analyzer/time/models/estimate.py` - LightGBM モデル
- [ ] `src/analyzer/time/runner.py` - 実行エントリ
- [ ] `scripts/run_estimate.py` - CLI エントリーポイント

### analyzer スキーマ（中間テーブル）
- [ ] analyzer スキーマ作成（マイグレーション）
- [ ] analyzer 用 dbt プロジェクト（`analyzer/transform/`）
- [ ] analyzer.v_time_ml_daily ビュー（ML 用日次集計）

### core スキーマ（最終出力）
- [ ] core.fct_time_daily_estimate テーブル（JSONB スナップショット）

### 運用
- [ ] 日次バッチスケジューラ（タスクスケジューラ / GitHub Actions）
- [ ] dim_holidays テーブル（祝日マスタ）

### ベースライン比較用
- [ ] v1: 単純移動平均
- [ ] v2: 曜日パターン
- [ ] v3: day_type 別パターン

## 関連ドキュメント

- [ADR-003 フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop)
- [005 推定値（estimate）](/100-development/120-specifications/123-transform/schema/core/005-estimate)
