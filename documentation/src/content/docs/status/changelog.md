---
title: 変更履歴
description: バージョンごとの変更内容
---

# 変更履歴

## v0.1.0 (開発中)

**目標**: MVP - 最低限の可視化とLLMによる分析を可能にする

### 追加
- 8サービスの同期対応（raw層）
  - Toggl Track、Google Calendar、Fitbit、Zaim
  - Tanita Health Planet、Trello、TickTick、Airtable
- 管理コンソール
  - OAuth認証フロー
  - Supabase Vault連携
  - GitHub Actions連携（同期実行、使用量表示）
- dbt staging層
  - Toggl Track（9モデル + 47テスト）
  - Google Calendar（4モデル + 29テスト + seed）
  - Fitbit（予定）
  - Zaim（予定）
  - Tanita（予定）
- Grafana ダッシュボード（staging確認用）（予定）
- dbt基盤
  - generate_schema_name マクロ（カスタムスキーマ対応）
  - seeds スキーマ
  - security_invoker 自動設定

### 変更
- Google Calendar 同期モジュールをリファクタリング（gcalendar.py → google_calendar/）
- dbt-run.yml を run_dbt.py ラッパー経由に変更

---

## 開発履歴（詳細）

### 2025-12-05

- Google Calendar staging層完成（4モデル + 29テスト）
- dbt seeds スキーマ追加（google_calendar_event_color_names）
- dbt generate_schema_name マクロ追加
- Admin Console の OAuth フロー改善
- リリース戦略を改訂

### 2025-12-04

- Toggl Track staging層完成（9モデル + 47テスト）
- dbt プロジェクト初期化

### 2025-12-XX（過去）

- 8サービスの同期実装完了
- 管理コンソール実装
- GitHub Actions ワークフロー整備
- ドキュメント整備
