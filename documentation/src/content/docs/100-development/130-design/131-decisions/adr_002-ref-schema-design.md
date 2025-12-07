---
title: ADR-002 分析軸マスタ設計
description: dbt seedsによるマスタ・マッピングテーブルの設計方針
---

# ADR-002: 分析軸マスタ設計

## ステータス

採用（2025-12-06）

## コンテキスト

DWHの分析レイヤー（core/marts）を構築するにあたり、以下が必要：

1. **マスタデータ** - サービス横断で使う分類定義（サービス非依存）
2. **マッピングテーブル** - サービス固有の値を統一分類に変換（サービス依存）

### 設計原則

- **マスタはサービス非依存**: 概念定義のみを持ち、Toggl/Calendarなど特定サービスの情報を含まない
- **マッピングでサービス固有値を変換**: 色やclient名など、サービス固有の値からマスタへの変換を担当
- **将来のサービス追加・削除に対応**: Togglがなくなっても、マスタの概念は維持される

### dbt seedsの役割

**dbt seedsがDWHの分析軸を定義する中核**である：

```
seeds (分析軸の定義・変換ルール)
├── mst_* : ドメインの分析軸を定義（サービス非依存）
└── map_* : サービス固有値 → 分析軸への変換ルール

staging (データクリーニング)
└── サービスごとのJSONB展開・型正規化

core (変換結果)
└── staging + seeds.map_* を適用した結果
    サービス名を隠蔽し、統一された分析軸で表現
```

- **seeds**: 「何を分析軸とするか」と「どう変換するか」のビジネスロジック
- **core**: 変換ルールを適用した結果のデータ

coreのファクトテーブル（`fct_time_actual`等）は、stagingデータに`seeds.map_*`のJOINを適用して、`seeds.mst_*`の分析軸に変換した結果に過ぎない。

## 決定

### dbt seedsによる管理

**すべてのマスタ・マッピングデータはdbt seedsで管理し、seedsスキーマに配置する。**

#### 理由

1. **分析軸の一貫性**: マッピングが頻繁に変わると分析軸として機能しない。変更頻度は月1回以下が想定される
2. **dbt原則への準拠**: dbtは静的な参照データをseedsで管理することを推奨している
3. **バージョン管理**: CSV変更がgitで追跡され、変更履歴が残る
4. **シンプルさ**: マイグレーション不要、テーブル作成はdbtが担当

#### ワークフロー

1. CSV編集（VSCode / GitHub UI）
2. PR作成 → レビュー → merge
3. `dbt seed` 実行（定期実行 or 手動dispatch）

### ファイル構成

```
dbt/seeds/
├── mst_time_social_categories.csv
├── mst_time_personal_categories.csv
├── map_toggl_client_to_time_social.csv
├── map_toggl_color_to_time_personal.csv   -- API色情報も統合
├── map_gcal_desc_to_time_social.csv
└── map_gcal_color_to_time_personal.csv    -- API色情報も統合
```

配置先: `seeds.*`（seedsスキーマ）

**注**: API仕様の色情報（色名、HEX値）はマッピングテーブルに統合する。別ファイルに分ける必要はない。

### 命名規則

#### マスタテーブル（mst_）

```
mst_{domain}_{axis}_categories
```

| 要素 | 説明 | 例 |
|------|------|-----|
| domain | ビジネスドメイン | `time`, `expense`, `health` |
| axis | 分類軸 | `social`, `personal` |

| テーブル名 | 説明 |
|-----------|------|
| `mst_time_social_categories` | 時間の社会的分類（VITALS, WORK, LEISURE等） |
| `mst_time_personal_categories` | 時間の個人的分類（管理、勉強等） |
| `mst_expense_categories` | 支出カテゴリ（将来） |

#### マッピングテーブル（map_）

```
map_{service}_{source}_to_{domain}_{axis}
```

| 要素 | 説明 | 例 |
|------|------|-----|
| service | マッピング元サービス | `toggl`, `gcal`, `zaim` |
| source | マッピング元の属性 | `client`, `color`, `desc` |
| domain | ターゲットドメイン | `time`, `expense` |
| axis | ターゲット軸 | `social`, `personal` |

| テーブル名 | 説明 |
|-----------|------|
| `map_toggl_client_to_time_social` | Toggl client → 時間social |
| `map_toggl_color_to_time_personal` | Toggl色 → 時間personal（色名・HEX含む） |
| `map_gcal_desc_to_time_social` | Calendar description → 時間social |
| `map_gcal_color_to_time_personal` | Calendar色 → 時間personal（色名・HEX含む） |
| `map_zaim_category_to_expense` | Zaim category → 支出カテゴリ（将来） |

### 時間分類の2軸設計（social / personal）

時間は**2つの独立した軸**で分類する。これらは直交する概念であり、階層関係ではない。

| 軸 | 意味 | データソース |
|----|------|-------------|
| **social** | 対外的・共有可能な分類（他者に説明するための語彙） | Toggl client / Calendar description 1行目 |
| **personal** | 内省的・個人的分類（自己理解のための語彙） | Toggl color / Calendar event color |

#### social（ソーシャル）

他者（LLMや友人）に時間の使い方を説明するための共通言語。Toggl Trackでは**client**に、Google Calendarでは**description の1行目**に記載する。

| name | name_ja | description |
|------|---------|-------------|
| VITALS | 生命維持 | Activities essential for survival (sleep, meals, bathing) |
| HOUSEHOLD | 家事 | Household maintenance (cleaning, shopping, cooking) |
| WORK | 仕事 | Work and professional activities |
| LEISURE | 余暇 | Leisure and entertainment |
| GROWTH | 成長 | Personal growth and investment (learning, exercise, reflection) |

#### personal（パーソナル）

自分にとってその時間がどんな価値を持っていたかの内省。Toggl Trackでは**project の色**で、Google Calendarでは**event の色**で表現する。

| name | name_ja | description |
|------|---------|-------------|
| sleep | 睡眠 | Sleep time |
| essential | 必須 | Essential tasks |
| errand | 用事 | Errands and chores |
| work | 仕事 | Professional work |
| leisure | 余暇 | Leisure and rest |
| study | 勉強 | Self-directed learning |
| academic | 学問 | Academic research and specialized study |
| exercise | 運動 | Physical activity |
| manage | 管理 | Task management and planning |
| drift | 漂流 | Unproductive time |
| unused | 未使用 | Uncategorized |

#### 2軸の独立性

social と personal は**独立して割り当て可能**。例えば：

| 活動 | social | personal |
|------|--------|----------|
| 業務でのプログラミング | WORK | work |
| 業務での学習 | WORK | study |
| プライベートでのプログラミング | GROWTH | study |
| 通勤中の読書 | WORK | study |
| ダラダラSNS | LEISURE | drift |

### 用語の統一

サービス固有の用語をシステム共通の用語に統一する。

**時間管理ドメイン：**

| サービス用語 | 統一用語 | 説明 |
|-------------|---------|------|
| Toggl client | time_category_social | 時間social（WORK, LEISUREなど） |
| Calendar description (1行目) | time_category_social | 同上 |
| Toggl project.color | time_category_personal | 時間personal（manage, study, workなど） |
| Calendar event.color | time_category_personal | 同上 |

将来的に支出ドメインを追加する場合：

| サービス用語 | 統一用語 |
|-------------|---------|
| Zaim category | expense_category |

## テーブル設計

### mst_time_social_categories

時間social分類のマスタ。サービス非依存。

| カラム | 型 | 説明 |
|--------|-----|------|
| name | TEXT | PK, カテゴリ名（VITALS, WORK等） |
| name_ja | TEXT | 日本語名（生命維持、仕事等） |
| description | TEXT | 説明（英語） |
| sort_order | INTEGER | 表示順 |

### mst_time_personal_categories

時間personal分類のマスタ。サービス非依存。

| カラム | 型 | 説明 |
|--------|-----|------|
| name | TEXT | PK, カテゴリ名（sleep, work等） |
| name_ja | TEXT | 日本語名（睡眠、仕事等） |
| description | TEXT | 説明（英語） |
| sort_order | INTEGER | 表示順 |

### map_toggl_client_to_time_social

Toggl clientから時間socialへのマッピング。

| カラム | 型 | 説明 |
|--------|-----|------|
| toggl_client_name | TEXT | PK, Toggl client名 |
| time_category_social | TEXT | FK → mst_time_social_categories.name |

### map_toggl_color_to_time_personal

Toggl色から時間personalへのマッピング。API色情報を統合。

| カラム | 型 | 説明 |
|--------|-----|------|
| toggl_color_hex | TEXT | PK, Toggl色HEX（#0b83d9等） |
| toggl_color_name | TEXT | Toggl色名（Blue等） |
| time_category_personal | TEXT | FK → mst_time_personal_categories.name |

### map_gcal_desc_to_time_social

Calendar descriptionから時間socialへのマッピング。

| カラム | 型 | 説明 |
|--------|-----|------|
| gcal_description_first_line | TEXT | PK, description 1行目 |
| time_category_social | TEXT | FK → mst_time_social_categories.name |

### map_gcal_color_to_time_personal

Calendar色から時間personalへのマッピング。API色情報を統合。

| カラム | 型 | 説明 |
|--------|-----|------|
| gcal_color_id | TEXT | PK, Calendar API色ID（1〜11） |
| gcal_color_name | TEXT | 色名（Lavender等） |
| gcal_color_hex | TEXT | HEX値（参考用） |
| time_category_personal | TEXT | FK → mst_time_personal_categories.name |

## Calendar イベントの記述ルール

| フィールド | 用途 | 例 |
|-----------|------|-----|
| summary | 自由記述（何をするか） | "企画書作成" |
| description | 1行目: social名<br>2行目以降: 自由記述 | "WORK<br>A社向け提案" |
| color | 時間personal | Blueberry（仕事） |

## dbt標準との対応

| dbt標準 | 本プロジェクト | 用途 |
|--------|--------------|------|
| seeds | seeds.mst_* / seeds.map_* | マスタ・マッピング定義 |
| staging | staging.stg_* | JSONB展開・型正規化 |
| intermediate | core.fct_* / core.dim_* | サービス統合・ビジネスエンティティ |
| marts | marts.agg_* | 分析集計 |

`core`は`intermediate`の別名（短い名前を採用）。

## 関連

- [データベーススキーマ設計](/100-development/130-design/database-schema)
- [DWH 4層アーキテクチャ](/100-development/120-specifications/121-overview/dwh-layers)
- [dbt Best Practices: How we structure our dbt projects](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview)
