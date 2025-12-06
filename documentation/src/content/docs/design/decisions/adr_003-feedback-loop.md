---
title: ADR-003 フィードバックループ
description: 4 Information × 4 Practices による時間管理サイクルの設計
---

# ADR-003: 時間管理フィードバックループ

## ステータス

採用（2025-12-07）

## コンテキスト

時間管理において、単なる実績記録だけでなく、予測・目標・計画を含むフィードバックループが必要。これにより「できる」「したい」「する」「した」のサイクルを回し、意図的な改善を可能にする。

## 4 Information × 4 Practices

### 4つの情報（状態）

データ（datetime型の生の値）に意味づけを行い、4種類の情報として扱う。

| 情報 | 意味 | 位置 | データソース |
|------|------|------|-------------|
| **actual** | 実際に起きた | 客観・確定 | Toggl |
| **estimate** | 起こりうる | 客観・未確定 | DWH計算結果 |
| **target** | 起こしたい | 主観・未確定 | 目標テーブル |
| **plan** | 起こすと決めた | 主観・確定 | Google Calendar |

### 2×2マトリクス

```
          確定        未確定
客観    actual    ←→  estimate
          ↑              ↓
主観     plan     ←→   target
```

- 対角ペア: actual ↔ target（現実 vs 理想）、estimate ↔ plan（予測 vs 決定）
- ループの流れ: 客観→主観、未確定→確定という2軸の変化が1サイクルで起こる

### 4つの実践（4A）

情報を変換するための意図的な実践。

| Practice | 変換 | 説明 |
|----------|------|------|
| **analysis** | actual → estimate | 実績を分析して「できる」を導出 |
| **aim** | estimate → target | 戦略を加えて「したい」を決定 |
| **adjustment** | target → plan | 現実制約と擦り合わせ「する」を決定 |
| **action** | plan → actual | 実行して「した」が生まれる |

## UXストーリー

1. **actual**: ユーザーはTogglで時間を記録する
2. **estimate**: DWH+BIのGrafanaダッシュボードで予測値を確認する
3. **target**: 目標値を参照する（「1年後に合格するには明日3時間勉強が必要」など）
4. **plan**: Google Calendarで明日の予定を立てる（「3時間勉強したいけど、友達と出かけるから1時間にしよう」）

## DWHでの表現

| 情報 | DWHレイヤー | テーブル/ビュー | 備考 |
|------|-------------|----------------|------|
| actual | core | `fct_time_records_actual` | Togglから取得 |
| estimate | marts | 集計ビュー | actual + plan から計算 |
| target | seeds | `mst_time_targets` | 目標値 |
| plan | core | `fct_time_records_plan` | Google Calendarから取得 |

## 関連ADR

- [ADR-004 day_type設計](/design/decisions/adr_004-day-type-design) - 日タイプの導出ロジック

## 関連仕様

- [004 目標管理（target）](/specifications/schema/core/004-target) - 目標管理の設計
- [005 推定値（estimate）](/specifications/schema/core/005-estimate) - 推定値の設計

## 関連

- [ADR-002 分析軸マスタ設計](/design/decisions/adr_002-ref-schema-design)
- [データベーススキーマ設計](/design/database-schema)
