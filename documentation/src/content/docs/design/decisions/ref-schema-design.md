---
title: ADR-002 refスキーマ設計
description: マスタテーブルとマッピングテーブルの設計方針
---

# ADR-002: refスキーマ設計

## ステータス

採用（2025-12-05）

## コンテキスト

DWHの分析レイヤー（core/marts）を構築するにあたり、以下が必要：

1. **マスタデータ** - サービス横断で使う分類定義
2. **マッピングテーブル** - サービス固有の値を統一分類に変換

これらはdbt seedsでも管理できるが、**UIから柔軟に編集したい**要件があるため、通常のテーブルとしてrefスキーマに配置する。

## 決定

### スキーマ構成

```
ref/
├── mst_*          -- マスタテーブル
└── map_*          -- マッピングテーブル
```

### 命名規則

| プレフィックス | 用途 | 例 |
|---------------|------|-----|
| `mst_` | マスタデータ | `mst_time_categories`, `mst_time_qualities` |
| `map_` | マッピング | `map_gcalendar_categories` |

### 用語の統一

サービス固有の用語をシステム共通の用語に統一する。

**時間管理ドメイン：**

| サービス用語 | 統一用語 | 説明 |
|-------------|---------|------|
| Toggl client | time_category | 時間カテゴリ（WORK, LEISUREなど） |
| Toggl project.color | time_quality | 時間の質（管理、勉強、仕事など） |
| Calendar event.color | time_quality | 同上 |

将来的に支出ドメインを追加する場合：

| サービス用語 | 統一用語 |
|-------------|---------|
| Zaim category | expense_category |

## テーブル設計

### ref.mst_time_categories

時間カテゴリのマスタ。Togglのclientと1:1対応。

```sql
CREATE TABLE ref.mst_time_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE  -- 'WORK', 'LEISURE', 'ACADEMIC' など
);
```

### ref.mst_time_qualities

時間の質のマスタ。Togglの色とCalendarの色をマッピング。

```sql
CREATE TABLE ref.mst_time_qualities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,              -- '管理', '勉強', '仕事' など
  toggl_color_hex TEXT,            -- '#0b83d9'
  toggl_color_name TEXT,           -- 'Blue'
  gcalendar_color_hex TEXT,        -- '#039be5'
  gcalendar_color_name TEXT,       -- 'Peacock'
  gcalendar_color_id TEXT          -- '7'
);
```

**初期データ：**

| name | toggl_color | gcalendar_color |
|------|-------------|-----------------|
| 管理 | Blue `#0b83d9` | Peacock `#039be5` |
| 勉強 | Green `#2da608` | Basil `#0b8043` |
| 用事 | Teal `#06a893` | Sage `#33b679` |
| 必須 | Peach `#c9806b` | Flamingo `#e67c73` |
| 仕事 | Indigo `#465bb3` | Blueberry `#3f51b5` |
| 余暇 | Magenta `#990099` | Grape `#8e24aa` |
| 漂流 | Olive `#566614` | Lavender `#7986cb` |
| 未使用 | Gray `#525266` | Graphite `#616161` |
| 睡眠 | Orange `#e36a00` | Tangerine `#f4511e` |
| 運動 | Yellow `#c7af14` | Banana `#f6bf26` |
| 学問 | Red `#d92b2b` | Tomato `#d50000` |

### ref.map_gcalendar_categories

Google Calendarのdescription（1行目）から時間カテゴリへのマッピング。

```sql
CREATE TABLE ref.map_gcalendar_categories (
  id SERIAL PRIMARY KEY,
  description_pattern TEXT NOT NULL,  -- "WORK", "LEISURE" など
  category_id INTEGER REFERENCES ref.mst_time_categories(id)
);
```

## Calendar イベントの記述ルール

| フィールド | 用途 | 例 |
|-----------|------|-----|
| summary | 自由記述（何をするか） | "企画書作成" |
| description | 1行目: カテゴリ名<br>2行目以降: 自由記述 | "WORK<br>A社向け提案" |
| color | 時間の質 | Blueberry（仕事） |

## seeds vs ref の使い分け

| 方式 | 変更方法 | UI編集 | 用途 |
|------|----------|--------|------|
| dbt seeds | CSV編集 → `dbt seed` | ❌ | 静的な参照データ |
| ref テーブル | Table Editor / API | ✅ | 運用中に変更するマスタ |

時間の質・カテゴリは運用中に調整する可能性があるため、refテーブルを採用。

## 関連

- [データベーススキーマ設計](/design/database-schema)
- [リリース戦略](/design/decisions/release-strategy)
