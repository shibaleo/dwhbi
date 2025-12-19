# 推奨睡眠時間の計算モデル

## 概要

睡眠データの自己相関分析に基づき、日ごとの「位相」を考慮した推奨睡眠時間を算出するモデル。

## 背景となる発見

### 睡眠周期の特定（700日間の自己相関分析）

| 周期 | 相関係数 | 意味 |
|------|----------|------|
| 1日 | +0.136 | 連続した日は似たパターンになる（慣性） |
| 6日 | +0.071 | 短期の概週リズム（7日より短い） |
| 21日 | +0.064 | 中期リズム（3週間） |
| 70日 | +0.129 | グレートリセット周期（最強の周期シグナル） |

### 発見された事実

- 短期（8日）の負の相関は300日データでは見えたが、700日データでは消失。生活パターンへの一時的適応であり本質的な体内リズムではない
- 21日の倍数（21, 42, 63日）で正の相関ピークが繰り返し出現
- 70日周期は相関係数+0.129で最も強いシグナル

## 推奨睡眠時間の計算式

### 総合リスクスコア

```
total_risk(x) = phase_risk(x) + base_risk(x)
```

ここで x は睡眠時間（時間）。

### 位相リスク（Phase Risk）

```
phase_risk(x) = |x - lag_1| × 0.136
              + |x - lag_6| × 0.071
              + |x - lag_21| × 0.064
              + |x - lag_70| × 0.129
```

- lag_i: i日前の睡眠時間
- 係数: 各ラグの相関係数（統計的に有意な周期のみ使用）

### ベースリスク（Base Risk）

```
base_risk(x) = |x - MA_70d|^1.3 × 0.5
```

- MA_70d: 過去70日間の移動平均
- 指数1.3: 位相とベースの影響が拮抗する点

### 指数1.3の根拠

指数を0.1〜3.0で変化させた実験結果：

| 指数範囲 | 推奨値の挙動 | 解釈 |
|----------|--------------|------|
| 0.1〜1.2 | 位相最適値で固定 | 位相が完全支配 |
| 1.3〜1.5 | 変化開始 | 位相とベースが拮抗（バランス点） |
| 2.0以上 | MA_70dに収束 | ベースが支配的 |

指数1.3は「位相を信頼しつつ、長期平均からも極端に乖離しない」バランス点。

### 推奨睡眠時間

```
optimal_sleep = argmin_x total_risk(x)  （x ∈ [6h, 10h]）
```

total_risk(x) を最小化する x が推奨睡眠時間。

## 必要なデータ構造

### 入力データ

```sql
-- 基本テーブル: core.fct_health_sleep_actual_timer
-- カラム:
--   sleep_date: 睡眠日（DATE）
--   duration_seconds: 睡眠時間（秒）
```

### 計算に必要な中間データ

```sql
WITH daily_sleep AS (
  SELECT 
    sleep_date,
    duration_seconds / 3600.0 AS sleep_hours
  FROM core.fct_health_sleep_actual_timer
),
with_lags AS (
  SELECT 
    sleep_date,
    sleep_hours,
    LAG(sleep_hours, 1) OVER (ORDER BY sleep_date) as lag_1,
    LAG(sleep_hours, 6) OVER (ORDER BY sleep_date) as lag_6,
    LAG(sleep_hours, 21) OVER (ORDER BY sleep_date) as lag_21,
    LAG(sleep_hours, 70) OVER (ORDER BY sleep_date) as lag_70,
    AVG(sleep_hours) OVER (
      ORDER BY sleep_date 
      ROWS BETWEEN 70 PRECEDING AND 1 PRECEDING
    ) as ma_70
  FROM daily_sleep
)
```

### 推奨睡眠時間の計算クエリ（完全版）

```sql
WITH daily_sleep AS (
  SELECT 
    sleep_date,
    duration_seconds / 3600.0 AS sleep_hours
  FROM core.fct_health_sleep_actual_timer
),
with_lags AS (
  SELECT 
    sleep_date,
    sleep_hours,
    LAG(sleep_hours, 1) OVER (ORDER BY sleep_date) as lag_1,
    LAG(sleep_hours, 6) OVER (ORDER BY sleep_date) as lag_6,
    LAG(sleep_hours, 21) OVER (ORDER BY sleep_date) as lag_21,
    LAG(sleep_hours, 70) OVER (ORDER BY sleep_date) as lag_70,
    AVG(sleep_hours) OVER (
      ORDER BY sleep_date 
      ROWS BETWEEN 70 PRECEDING AND 1 PRECEDING
    ) as ma_70
  FROM daily_sleep
),
today_options AS (
  SELECT generate_series(360, 600, 5) / 60.0 AS x  -- 6h〜10h、5分刻み
),
all_scores AS (
  SELECT 
    w.sleep_date,
    w.sleep_hours as actual_sleep,
    t.x,
    -- 位相リスク
    (ABS(t.x - w.lag_1) * 0.136 +
     ABS(t.x - w.lag_6) * 0.071 +
     ABS(t.x - w.lag_21) * 0.064 +
     ABS(t.x - w.lag_70) * 0.129) +
    -- ベースリスク（指数1.3）
    POWER(ABS(t.x - w.ma_70), 1.3) * 0.5 AS total_risk
  FROM with_lags w
  CROSS JOIN today_options t
  WHERE w.lag_70 IS NOT NULL
),
ranked AS (
  SELECT 
    sleep_date,
    actual_sleep,
    x,
    total_risk,
    ROW_NUMBER() OVER (PARTITION BY sleep_date ORDER BY total_risk) as rn
  FROM all_scores
)
SELECT 
  sleep_date AS time,
  x AS recommended_sleep_hours,
  actual_sleep AS actual_sleep_hours
FROM ranked
WHERE rn = 1
ORDER BY sleep_date
```

### 今日の推奨睡眠時間のみを取得するクエリ

```sql
WITH daily_sleep AS (
  SELECT 
    sleep_date,
    duration_seconds / 3600.0 AS sleep_hours,
    ROW_NUMBER() OVER (ORDER BY sleep_date DESC) as days_ago
  FROM core.fct_health_sleep_actual_timer
),
key_lags AS (
  SELECT 
    MAX(CASE WHEN days_ago = 1 THEN sleep_hours END) as lag_1,
    MAX(CASE WHEN days_ago = 6 THEN sleep_hours END) as lag_6,
    MAX(CASE WHEN days_ago = 21 THEN sleep_hours END) as lag_21,
    MAX(CASE WHEN days_ago = 70 THEN sleep_hours END) as lag_70
  FROM daily_sleep
  WHERE days_ago IN (1, 6, 21, 70)
),
ma_70d AS (
  SELECT AVG(sleep_hours) as ma_70
  FROM daily_sleep
  WHERE days_ago <= 70
),
today_options AS (
  SELECT generate_series(360, 600, 1) / 60.0 AS x
),
scores AS (
  SELECT 
    t.x,
    (ABS(t.x - l.lag_1) * 0.136 +
     ABS(t.x - l.lag_6) * 0.071 +
     ABS(t.x - l.lag_21) * 0.064 +
     ABS(t.x - l.lag_70) * 0.129) +
    POWER(ABS(t.x - m.ma_70), 1.3) * 0.5 AS total_risk
  FROM today_options t
  CROSS JOIN key_lags l
  CROSS JOIN ma_70d m
)
SELECT ROUND(x::numeric, 2) AS optimal_sleep
FROM scores
ORDER BY total_risk
LIMIT 1
```

## Grafana変数への登録

Dashboard Variables で `optimal_sleep` として登録し、他のパネルで `$optimal_sleep` として参照可能。

## 解釈と活用

### 推奨値の意味

- 推奨値は「位相リスクとベースリスクの合計が最小になる睡眠時間」
- 位相に順行した睡眠を取ることで、体内リズムとの整合性が保たれる
- 70dMAから極端に離れない範囲で、位相に合わせた調整が行われる

### 実用的な判断基準

- 推奨値が8h未満の場合：「今日は短めでもOK」の位相
- 推奨値が8h以上の場合：「今日は長めに寝るべき」の位相
- 社会的制約で推奨値を確保できない場合でも、乖離幅が小さければリスクは限定的

## marts層のデータ構造（設計）

### v_sleep_autocorrelation（自己相関係数ビュー）

1〜120日の全ラグの自己相関係数を動的に計算するビュー。

```sql
-- marts.v_sleep_autocorrelation
CREATE VIEW marts.v_sleep_autocorrelation AS
WITH daily_sleep AS (
  SELECT 
    sleep_date,
    duration_seconds / 3600.0 AS sleep_hours
  FROM core.fct_health_sleep_actual_timer
),
with_lags AS (
  SELECT 
    sleep_hours,
    LAG(sleep_hours, 1) OVER (ORDER BY sleep_date) as lag_1,
    LAG(sleep_hours, 2) OVER (ORDER BY sleep_date) as lag_2,
    -- ... lag_3 〜 lag_119 ...
    LAG(sleep_hours, 120) OVER (ORDER BY sleep_date) as lag_120
  FROM daily_sleep
)
SELECT 1 as lag_days, CORR(sleep_hours, lag_1) as correlation FROM with_lags
UNION ALL SELECT 2, CORR(sleep_hours, lag_2) FROM with_lags
-- ... 3 〜 119 ...
UNION ALL SELECT 120, CORR(sleep_hours, lag_120) FROM with_lags;
```

### 活用方法

**1. 相関係数グラフ（Grafana）**

```sql
SELECT lag_days, correlation 
FROM marts.v_sleep_autocorrelation
ORDER BY lag_days;
```

**2. 推奨睡眠時間の計算**

```sql
SELECT lag_days, correlation 
FROM marts.v_sleep_autocorrelation
WHERE lag_days IN (1, 6, 21, 70);
```

**3. FFT（周波数解析）**

自己相関係数の系列をFFTにかけることで、周期成分をより厳密に特定可能。

### メリット

- 相関係数がデータ蓄積に伴い自動更新される
- 季節変動や生活パターンの変化が自然に反映される
- 複数の分析（推奨計算、周期特定、FFT）で再利用可能
- Grafanaクエリがシンプルになる

## 今後の改善案

1. v_sleep_autocorrelationのdbtモデル実装
2. FFTによる周期成分の厳密な特定
3. 季節変動の考慮
4. 曜日パターンの組み込み
5. 実際の健康指標（疲労度、集中力など）との相関検証

---

作成日: 2025-12-19
分析期間: 700日間の睡眠データに基づく
