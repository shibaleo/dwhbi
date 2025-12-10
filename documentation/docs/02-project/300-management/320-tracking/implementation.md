---
title: 実装状況
description: 各機能の実装状況
---

# 実装状況

## サービス同期

| サービス | パイプライン | DB スキーマ | 管理UI | テスト |
|---------|:-----------:|:----------:|:------:|:-----:|
| Toggl Track | ✅ | ✅ | ✅ | ✅ |
| Fitbit | ✅ | ✅ | ✅ | ✅ |
| Zaim | ✅ | ✅ | ✅ | ✅ |
| Google Calendar | ✅ | ✅ | ✅ | ✅ |
| Tanita Health Planet | ✅ | ✅ | ✅ | ✅ |
| Trello | ✅ | ✅ | ✅ | ✅ |
| TickTick | ✅ | ✅ | ✅ | - |
| Airtable | ✅ | ✅ | ✅ | - |

## DWH レイヤー

| レイヤー | 実装状況 | 説明 |
|---------|:-------:|------|
| raw | ✅ | 全サービスのテーブル作成済み |
| staging | 🚧 | Toggl Track、Google Calendar 完了 |
| seeds | ✅ | カテゴリマスタ・マッピング6テーブル |
| core | 🚧 | 時間統合ビュー実装済み |
| marts | - | 未実装 |

### staging層詳細

| サービス | モデル数 | テスト数 | ステータス |
|---------|:-------:|:------:|:------:|
| Toggl Track | 9 | 47 | ✅ |
| Google Calendar | 4 | 25 | ✅ |
| Fitbit | - | - | ⭕ 予定 |
| Zaim | - | - | ⭕ 予定 |
| Tanita | - | - | ⭕ 予定 |
| Trello | - | - | - |
| TickTick | - | - | - |
| Airtable | - | - | - |

### core層詳細

| モデル | テスト数 | 説明 |
|--------|:-------:|------|
| fct_time_records_actual | 11 | Toggl実績（日跨ぎ分割・カテゴリマッピング済み） |
| fct_time_records_plan | 11 | Google Calendar計画（日跨ぎ分割・カテゴリマッピング済み） |
| fct_time_records_unified | 12 | actual/planをCURRENT_TIMESTAMP境界で統合 |
| dim_day_types | 9 | 日タイプ導出（ADR-004ハイブリッドロジック） |

## 管理ダッシュボード

| 機能 | 実装状況 |
|-----|:-------:|
| ログイン | ✅ |
| サービス設定 | ✅ |
| 同期ログ表示 | ✅ |
| OAuth認証フロー | ✅ |
| Vault連携 | ✅ |

## インフラ

| 項目 | 実装状況 |
|-----|:-------:|
| Supabase セットアップ | ✅ |
| Supabase Vault | ✅ |
| Vercel デプロイ | ✅ |
| GitHub Actions | ✅ |

## ドキュメント

| 項目 | 実装状況 |
|-----|:-------:|
| 要件定義 | ✅ |
| 仕様書 | ✅ |
| 設計書 | ✅ |
| 運用手順書 | ✅ |

## 凡例

- ✅ 実装済み
- 🚧 実装中
- - 未実装
