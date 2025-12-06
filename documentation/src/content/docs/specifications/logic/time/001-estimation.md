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

推定アルゴリズムは**外部の Python スクリプト**で実装する。
これにより、複雑な統計処理や機械学習モデルを柔軟に適用できる。

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

アルゴリズムは外部 Python スクリプトで実装する。以下は候補となるアルゴリズム。

### v1: 単純移動平均

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

### v2: 曜日パターン加味

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

### v3: day_type 別パターン

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

- [ ] Python スクリプト基盤
- [ ] v1: 単純移動平均
- [ ] v2: 曜日パターン
- [ ] v3: day_type 別パターン
- [ ] DB への JSONB 書き込み
- [ ] v_time_ml_daily ビュー
- [ ] dim_holidays テーブル（祝日マスタ）
- [ ] v4: Prophet（将来）
- [ ] v5: Foundation Models（将来）

## 関連ドキュメント

- [ADR-003 フィードバックループ](/design/decisions/adr_003-feedback-loop)
- [005 推定値（estimate）](/specifications/schema/core/005-estimate)
