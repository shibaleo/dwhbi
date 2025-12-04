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
| seeds | ✅ | google_calendar_event_color_names |
| core | - | 未実装 |
| marts | - | 未実装 |

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
