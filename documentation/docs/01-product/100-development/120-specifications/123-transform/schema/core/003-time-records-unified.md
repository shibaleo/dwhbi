---
title: fct_time_records_unified
description: actual/plan統合ビュー
---

# fct_time_records_unified

actual（実績）とplan（計画）を CURRENT_TIMESTAMP 境界で統合する。

## フィールド

| カラム | 型 | 説明 |
|--------|-----|------|
| **id** | TEXT | ユニークID |
| **source_id** | TEXT | 元のレコードID |
| **start_at** | TIMESTAMP | 開始時刻（JST） |
| **end_at** | TIMESTAMP | 終了時刻（JST） |
| **duration_seconds** | INTEGER | 時間（秒） |
| **description** | TEXT | 説明/タイトル |
| **time_category_social** | TEXT | 社会的分類 |
| **time_category_personal** | TEXT | 個人的分類 |
| **source** | TEXT | データソース（`'toggl_track'` / `'google_calendar'`） |
| **record_type** | TEXT | `'actual'` または `'plan'` |

## 境界ルール

| 条件 | record_type | 処理 |
|------|-------------|------|
| `end_at <= now` | actual | そのまま |
| `start_at < now < end_at` | actual | end_at を now に調整 |
| `start_at >= now` | plan | そのまま |
| `start_at < now < end_at` | plan | start_at を now に調整 |

※ `now` = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::timestamp`

## 境界をまたぐレコード例

```
現在時刻: 14:30 JST

actual (進行中):
  14:00 〜 NULL → unified: 14:00 〜 14:30 (actual)

plan (進行中):
  14:00 〜 16:00 → unified: 14:30 〜 16:00 (plan)
```

## SQL構成

```sql
-- 1. actual: 完了
SELECT ... WHERE end_at <= now

UNION ALL

-- 2. actual: 進行中（end_at調整）
SELECT ..., now as end_at WHERE start_at < now AND end_at > now

UNION ALL

-- 3. plan: 未来
SELECT ... WHERE start_at >= now

UNION ALL

-- 4. plan: 進行中（start_at調整）
SELECT ..., now as start_at WHERE start_at < now AND end_at > now
```

## 動的更新

CURRENT_TIMESTAMP を使用するため、ビュー参照ごとに境界が移動する。
