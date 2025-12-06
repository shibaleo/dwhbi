---
title: fct_time_records_actual
description: Togglからの実績時間レコード
---

# fct_time_records_actual

Togglから取得した時間記録を、日跨ぎ分割・カテゴリマッピング済みで提供する。

## フィールド

| カラム | 型 | 説明 | 必須 |
|--------|-----|------|:----:|
| **id** | TEXT | ユニークID（`{source_id}_{N}`） | ✓ |
| **source_id** | TEXT | 元のToggl time_entry_id | ✓ |
| **start_at** | TIMESTAMP | 開始時刻（JST、分割後） | ✓ |
| **end_at** | TIMESTAMP | 終了時刻（JST、分割後） | ✓ |
| **duration_seconds** | INTEGER | 時間（秒） | ✓ |
| **description** | TEXT | Togglのdescription | |
| **time_category_social** | TEXT | 社会的分類（WORK, LEISURE等） | ✓ |
| **time_category_personal** | TEXT | 個人的分類（Work, Study等） | ✓ |
| **source** | TEXT | データソース（`'toggl_track'`） | ✓ |

## ソース

```
stg_toggl_track__time_entries
  → projects (project_id)
    → clients (client_id)
```

## カテゴリマッピング

| カテゴリ | マッピング元 | seed |
|----------|-------------|------|
| time_category_social | クライアント名 | `map_toggl_client_to_time_social` |
| time_category_personal | プロジェクト色 | `map_toggl_color_to_time_personal` |

## 日跨ぎ分割

JST 00:00:00 を境界として再帰的に分割。

```
入力: 12/05 22:00 〜 12/07 08:00 (34h)

出力:
  xxx_1: 12/05 22:00 〜 12/06 00:00 ( 2h)
  xxx_2: 12/06 00:00 〜 12/07 00:00 (24h)
  xxx_3: 12/07 00:00 〜 12/07 08:00 ( 8h)
```

## 進行中レコード

`stopped_at` が NULL の場合、`CURRENT_TIMESTAMP` を代入。ビュー参照時に動的更新される。

```sql
coalesce(sr.stopped_at, current_timestamp)
```
