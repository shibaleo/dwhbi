---
title: 006 意向管理（intent）
description: intent（意向）のデータ設計
---

# 意向管理（intent）

## 概要

QPIモデルにおける intent（意向）の実装仕様。

intent は「こうしたい」という主観的・不確実な意向であり、target（調整済み目標）の入力となる。

### intent と target の関係

| 情報 | 生成者 | 性質 | 保存先 |
|------|--------|------|--------|
| intent | 人間 | 主観的な意向（不確実） | Supabase (JSONB) |
| target | LLM (adjuster) | 調整済み目標（確実） | Google Calendar |

```
intent (console で入力)
    │
    │  「Learning 週10時間」「6時前に起きる」
    │
    ▼
adjuster (LLM)
    │
    │  actual, estimate, 予定の空きなどを考慮
    │
    ▼
target (GCal にイベント展開)
```

## 設計方針

### 汎用的なフィールド指定

intent の対象は多様であり、事前に全てを定義できない：

- 時間カテゴリ別の合計時間（Learning 週10時間）
- 特定タグの合計時間（資格 週5時間）
- 起床時間（6時前に起きる）
- プロジェクト別の時間（side-project 週3時間）

そのため、`field` + `operator` + `value` の汎用構造を採用する。

### JSONB 保存 + dbt ビュー展開

target と同じパターンで、JSONB で保存し dbt ビューで展開する。

### 履歴管理（SCD Type 2）

intent の変遷を追跡するため、SCD Type 2 形式で履歴を保持する。

- `valid_from` / `valid_until`: intent 設定の有効期間
- 設定しないときは前回の値が継続（毎回入力する必要なし）
- 変更したら履歴が残る

## データ構造

### intent オブジェクト

```json
{
  "field": "duration_hours",
  "operator": "more",
  "value": 10,

  "filters": {
    "time_category_personal": "Learning"
  },

  "scope": {
    "start": "2025-01-06",
    "end": "2025-01-12"
  },
  "meta": {
    "valid_from": "2025-01-05",
    "valid_until": null,
    "note": "資格試験前なので学習多め"
  }
}
```

### フィールド定義

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|:----:|------|
| field | string | ✓ | 対象フィールド |
| operator | string | ✓ | 比較演算子 |
| value | any | ✓ | 目標値 |
| filters | object | - | 適用条件（null = 全体） |
| scope | object | - | 適用期間（null = 恒常的な intent） |
| scope.start | date | ✓* | 適用期間開始（scope ありの場合は必須） |
| scope.end | date | - | 適用期間終了（null = 終了未定） |
| meta.valid_from | date | ✓ | この intent の有効開始日（SCD Type 2） |
| meta.valid_until | date | - | 有効終了日（null = 現在有効） |
| meta.note | string | - | メモ（オプション） |

### PK

- `id` (UUID) を採用
- 同じ intent を複数持てる柔軟性を残す

### scope の扱い

| パターン | 意味 | 例 |
|---------|------|-----|
| scope: null | 恒常的な intent | 「毎日6時に起きたい」 |
| scope.start のみ | この日から（終了未定） | 「来週から Learning 強化」 |
| scope.start + end | 特定期間 | 「来週は Learning 10時間」 |

### field の種類（時間ドメイン）

| field | 説明 | value の型 | 例 |
|-------|------|-----------|-----|
| duration_hours | 合計時間 | number | 10 |
| duration_minutes | 合計時間（分） | number | 600 |
| start_time | 開始時刻 | time | "06:00:00" |
| end_time | 終了時刻 | time | "23:00:00" |
| count | 回数 | number | 5 |

### operator の種類

#### Phase 1（ミニマム）

| operator | 意味 | 達成条件 | value の型 |
|----------|------|----------|-----------|
| more | 以上 | actual >= value | number / time |
| less | 以下 | actual <= value | number / time |
| equal | 等しい | actual == value | number / time |
| between | 範囲内 | value[0] <= actual <= value[1] | [min, max] |

#### Phase 2（頻度・存在）

| operator | 意味 | 達成条件 | value の型 |
|----------|------|----------|-----------|
| exists | 存在する | 1回以上ある | boolean |
| every_day | 毎日ある | scope 内の全日に存在 | boolean |
| at_least_n_times | N回以上 | count >= value | number |

#### Phase 3（将来検討）

| operator | 意味 | 備考 |
|----------|------|------|
| more_than_last_week | 先週より多く | 相対値 |
| ratio_less | 割合が以下 | 全体に対する比率 |
| priority_over | 優先順位が上 | 複合条件 |

### intent タイプの分類

| タイプ | 例 | field | operator | value |
|--------|-----|-------|----------|-------|
| 量の目標 | Learning 週10時間以上 | duration_hours | more | 10 |
| 量の制限 | Drift 週7時間以下 | duration_hours | less | 7 |
| 時刻の目標 | 6時前に起きる | end_time | less | "06:00:00" |
| 時刻の制限 | 23時前に寝る | start_time | less | "23:00:00" |
| 頻度の目標 | 週3回運動 | count | more | 3 |
| 連続性 | 毎日学習する | - | every_day | true |
| 割合 | 仕事は全体の40%以下 | ratio | less | 0.4 |
| 存在 | 週1回は読書する | - | exists | true |
| 範囲 | 睡眠7-8時間 | duration_hours | between | [7, 8] |

### 難しいケース（将来課題）

- **複合条件**: 「平日は6時間、休日は8時間寝たい」
- **相対値**: 「先週より多く」
- **優先順位**: 「Learning > Work の時間配分」
- **トレードオフ**: 「Work を減らして Learning を増やす」

### filters の種類（時間ドメイン）

| filter | 説明 | 例 |
|--------|------|-----|
| time_category_personal | 個人カテゴリ | "Learning" |
| time_category_social | 社会カテゴリ | "Alone" |
| project | プロジェクト名 | "accounting" |
| tag | タグ名 | "資格" |
| description_contains | 説明に含む | "会計学" |

## 使用例

### 例1: カテゴリ別の時間目標

```json
{
  "field": "duration_hours",
  "operator": "more",
  "value": 10,
  "filters": { "time_category_personal": "Learning" },
  "scope": { "start": "2025-01-06", "end": "2025-01-12" },
  "meta": { "valid_from": "2025-01-05", "valid_until": null }
}
```

意味: 「来週は Learning に10時間以上」

### 例2: 起床時間

```json
{
  "field": "start_time",
  "operator": "less",
  "value": "06:00:00",
  "filters": { "time_category_personal": "Sleep" },
  "scope": { "start": "2025-01-06", "end": "2025-01-12" },
  "meta": { "valid_from": "2025-01-05", "valid_until": null }
}
```

意味: 「来週は6時前に起きる」（Sleep の終了 = 起床）

### 例3: 特定タグの時間

```json
{
  "field": "duration_hours",
  "operator": "more",
  "value": 5,
  "filters": { "tag": "資格" },
  "scope": { "start": "2025-01-06", "end": "2025-01-12" },
  "meta": { "valid_from": "2025-01-05", "valid_until": null }
}
```

意味: 「来週は資格タグの作業を5時間以上」

### 例4: 漂流時間の削減

```json
{
  "field": "duration_hours",
  "operator": "less",
  "value": 7,
  "filters": { "time_category_personal": "Drift" },
  "scope": { "start": "2025-01-06", "end": "2025-01-12" },
  "meta": { "valid_from": "2025-01-05", "valid_until": null }
}
```

意味: 「来週の漂流は7時間以下に」

## ストレージ

### テーブル構造

```sql
-- raw.time_intents
CREATE TABLE raw.time_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### dbt ビュー（案）

```sql
-- staging: stg_time_intents
SELECT
  id,
  data->>'field' AS field,
  data->>'operator' AS operator,
  data->'value' AS value,
  data->'filters' AS filters,
  (data->'scope'->>'start')::date AS scope_start,
  (data->'scope'->>'end')::date AS scope_end,
  (data->'meta'->>'valid_from')::date AS valid_from,
  (data->'meta'->>'valid_until')::date AS valid_until,
  data->'meta'->>'note' AS note,
  created_at
FROM raw.time_intents
```

## 入力 UI

console に intent 入力画面を実装する。

```
┌─────────────────────────────────────────────────┐
│ Intent 入力                                     │
├─────────────────────────────────────────────────┤
│ 期間: [2025-01-06] 〜 [2025-01-12]              │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Learning を週 [10] 時間以上                 │ │
│ │ 6時前に起きる                               │ │
│ │ 漂流を週 [7] 時間以下                       │ │
│ │ [+ 追加]                                    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ メモ: [資格試験前なので学習多め______]          │
│                                                 │
│ [保存]                                          │
└─────────────────────────────────────────────────┘
```

## 運用フロー

1. **設定不要時**: 何もしない（前回の intent が継続）
2. **変更時**: console で変更 → 既存レコードの valid_until を更新、新規レコード作成
3. **adjuster 実行**: intent + actual + estimate → target (GCal) を生成

## 未実装事項

- [ ] actual テーブルに project, tag を追加（比較に必要）
- [ ] adjuster による target 生成ロジック
- [ ] console の intent 入力 UI
- [ ] marts での intent vs actual 比較ビュー

## 関連ドキュメント

- [011 QPI モデル](/01-product/000-foundations/010-theory/011-qpi-model) - 4 Information 概念
- [004 目標管理（target）](/01-product/100-development/120-specifications/123-transform/schema/core/004-target) - target の設計
- [005 推定値（estimate）](/01-product/100-development/120-specifications/123-transform/schema/core/005-estimate) - estimate の設計
