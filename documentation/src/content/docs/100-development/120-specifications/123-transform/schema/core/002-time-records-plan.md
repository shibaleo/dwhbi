---
title: fct_time_records_plan
description: Google Calendarからの計画時間レコード
---

# fct_time_records_plan

Google Calendarから取得した予定を、日跨ぎ分割・カテゴリマッピング済みで提供する。

## フィールド

| カラム | 型 | 説明 | 必須 |
|--------|-----|------|:----:|
| **id** | TEXT | ユニークID（`{source_id}_{N}`） | ✓ |
| **source_id** | TEXT | 元のGCal event_id | ✓ |
| **start_at** | TIMESTAMP | 開始時刻（JST、分割後） | ✓ |
| **end_at** | TIMESTAMP | 終了時刻（JST、分割後） | ✓ |
| **duration_seconds** | INTEGER | 時間（秒） | ✓ |
| **description** | TEXT | GCalのsummary | |
| **time_category_social** | TEXT | 社会的分類（WORK, LEISURE等） | ✓ |
| **time_category_personal** | TEXT | 個人的分類（Work, Study等） | ✓ |
| **source** | TEXT | データソース（`'google_calendar'`） | ✓ |

## ソース

```
stg_google_calendar__events (status != 'cancelled')
```

## カテゴリマッピング

| カテゴリ | マッピング元 | seed |
|----------|-------------|------|
| time_category_social | descriptionの1行目 | `map_gcal_desc_to_time_social` |
| time_category_personal | イベント色 | `map_gcal_color_to_time_personal` |

## 日跨ぎ分割

JST 00:00:00 を境界として再帰的に分割（actualと同一ロジック）。

## 終日レコード

stagingで変換済み：
- `start_at`: 当日 00:00:00 JST
- `end_at`: 翌日 00:00:00 JST

## キャンセル除外

`status = 'cancelled'` のイベントは除外。
