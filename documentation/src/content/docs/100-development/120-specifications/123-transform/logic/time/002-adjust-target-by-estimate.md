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

## スキーマ配置

| テーブル | スキーマ | 管理方法 | 理由 |
|----------|----------|----------|------|
| estimate | `core` | Python (analyzer) で自動計算 | 最終出力のため core |
| target | `console` | 管理画面 GUI で CRUD | ユーザー操作のため console |
| plan | `core` | Google Calendar 同期 | 外部連携のため core |

### console スキーマの役割

`console` スキーマはユーザーが直接操作するデータを配置する:

- **特徴**: GUI から CRUD 操作される
- **例**: target（目標設定）、設定マスタ、ユーザー入力データ

### スキーマ分離の意図

```
raw       ← 外部 API 生データ（自動同期）
staging   ← クリーニング済み（dbt ビュー）
core      ← 最終出力（actual, estimate, plan）
console   ← ユーザー操作データ（target: SCD Type 2）
analyzer  ← 分析過程の中間テーブル・ビュー
seeds     ← マスタデータ（CSV）
marts     ← 分析・可視化用（将来）
```

## 入力

- `core.fct_time_daily_estimate`: 推定値（Python で計算）
- `console.fct_time_daily_target`: 目標値（**GUI で管理**）
- `core.fct_time_records_plan`: 計画（Google Calendar）

## 出力

- ダッシュボード表示用の差分データ
- （将来）plan 提案

## target テーブル設計（console スキーマ / SCD Type 2）

target テーブルは **SCD Type 2**（Slowly Changing Dimension Type 2）で設計し、変更履歴を保持する。

### SCD Type 2 の利点

- 目標値の変更履歴を追跡可能
- 過去の任意の時点での目標値を参照可能
- 「いつ、どのように目標を変更したか」を分析可能

### テーブル定義

```sql
-- console.fct_time_daily_target (SCD Type 2)
CREATE TABLE console.fct_time_daily_target (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ビジネスキー（自然キー）
    date_day DATE NOT NULL,
    time_category_personal TEXT NOT NULL,

    -- 属性
    duration_min INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('more', 'less', 'neutral')),
    priority INTEGER DEFAULT 0,
    note TEXT,

    -- SCD Type 2 管理カラム
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ,  -- NULL = 現在有効
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,

    -- 監査カラム
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,  -- 将来: ユーザー識別

    -- 制約: 同一ビジネスキーで is_current=TRUE は1件のみ
    CONSTRAINT unique_current_target
        UNIQUE (date_day, time_category_personal, is_current)
        DEFERRABLE INITIALLY DEFERRED
);

-- 現在有効なレコードのみのビュー
CREATE VIEW console.v_time_daily_target_current AS
SELECT * FROM console.fct_time_daily_target
WHERE is_current = TRUE;

-- インデックス
CREATE INDEX idx_target_current ON console.fct_time_daily_target (date_day, time_category_personal)
WHERE is_current = TRUE;

CREATE INDEX idx_target_valid_range ON console.fct_time_daily_target (date_day, time_category_personal, valid_from, valid_to);
```

### 列定義

| 列名 | 型 | 説明 |
|------|-----|------|
| id | UUID | サロゲートキー（各バージョンで一意） |
| date_day | DATE | 対象日（ビジネスキー） |
| time_category_personal | TEXT | カテゴリ（ビジネスキー） |
| duration_min | INTEGER | 目標時間（分） |
| direction | TEXT | 方向性（more/less/neutral） |
| priority | INTEGER | 優先度（高いほど優先） |
| note | TEXT | メモ・備考 |
| **valid_from** | TIMESTAMPTZ | このバージョンの有効開始日時 |
| **valid_to** | TIMESTAMPTZ | このバージョンの有効終了日時（NULL=現在有効） |
| **is_current** | BOOLEAN | 現在有効なレコードか |
| **version** | INTEGER | バージョン番号（1から開始） |
| created_at | TIMESTAMPTZ | レコード作成日時 |
| created_by | TEXT | 作成者（将来用） |

### SCD Type 2 更新ロジック

```sql
-- 更新時のストアドプロシージャ
CREATE OR REPLACE FUNCTION console.update_target_scd2(
    p_date_day DATE,
    p_category TEXT,
    p_duration_min INTEGER,
    p_direction TEXT,
    p_priority INTEGER DEFAULT 0,
    p_note TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_old_id UUID;
    v_new_id UUID;
    v_new_version INTEGER;
BEGIN
    -- 現在のレコードを取得
    SELECT id, version INTO v_old_id, v_new_version
    FROM console.fct_time_daily_target
    WHERE date_day = p_date_day
      AND time_category_personal = p_category
      AND is_current = TRUE;

    IF v_old_id IS NOT NULL THEN
        -- 旧レコードを無効化
        UPDATE console.fct_time_daily_target
        SET valid_to = NOW(),
            is_current = FALSE
        WHERE id = v_old_id;

        v_new_version := v_new_version + 1;
    ELSE
        v_new_version := 1;
    END IF;

    -- 新レコードを挿入
    INSERT INTO console.fct_time_daily_target (
        date_day, time_category_personal, duration_min, direction,
        priority, note, valid_from, is_current, version
    ) VALUES (
        p_date_day, p_category, p_duration_min, p_direction,
        p_priority, p_note, NOW(), TRUE, v_new_version
    ) RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;
```

### GUI CRUD 要件

管理コンソール（`console/`）で以下の操作を提供:

| 操作 | 説明 | SCD Type 2 動作 |
|------|------|-----------------|
| **Create** | 新規目標の追加 | version=1 で新規レコード作成 |
| **Read** | 目標一覧の表示 | `v_time_daily_target_current` を参照 |
| **Update** | 目標値の編集 | 旧レコード無効化 + 新バージョン作成 |
| **Delete** | 目標の削除（論理削除） | `is_current=FALSE`, `valid_to=NOW()` |
| **History** | 変更履歴の表示 | 全バージョンを時系列で表示 |

### API エンドポイント（Supabase）

```
# 現在有効な目標を取得（ビュー経由）
GET    /rest/v1/v_time_daily_target_current

# 目標を作成/更新（RPC経由）
POST   /rest/v1/rpc/update_target_scd2

# 履歴を含む全レコード取得
GET    /rest/v1/fct_time_daily_target?date_day=eq.2025-12-07&order=version.asc

# 特定時点の目標を取得
GET    /rest/v1/fct_time_daily_target?valid_from=lte.2025-12-01&valid_to=gt.2025-12-01
```

### 履歴クエリ例

```sql
-- 特定日付・カテゴリの変更履歴
SELECT
    version,
    duration_min,
    direction,
    valid_from,
    valid_to,
    is_current
FROM console.fct_time_daily_target
WHERE date_day = '2025-12-07'
  AND time_category_personal = 'Education'
ORDER BY version;

-- 特定時点での有効な目標
SELECT * FROM console.fct_time_daily_target
WHERE date_day = '2025-12-07'
  AND valid_from <= '2025-12-01 00:00:00'
  AND (valid_to IS NULL OR valid_to > '2025-12-01 00:00:00');
```

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

### console スキーマ・テーブル
- [ ] console スキーマ作成（マイグレーション）
- [ ] fct_time_daily_target テーブル作成
- [ ] RLS ポリシー設定

### 管理コンソール GUI（console/）
- [ ] target 一覧ページ
- [ ] target 作成フォーム
- [ ] target 編集フォーム
- [ ] target 削除機能
- [ ] 日付/カテゴリフィルタ

### 比較ロジック
- [ ] estimate vs target 比較クエリ
- [ ] plan vs target 比較クエリ
- [ ] Grafana ダッシュボード
- [ ] 差分ハイライト表示

### 将来
- [ ] plan 提案機能

## 関連ドキュメント

- [ADR-003 フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop)
- [001 推定値計算ロジック](/100-development/120-specifications/123-transform/logic/time/001-estimation)
