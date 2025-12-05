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
  - Google Calendar（4モデル + 25テスト + seed）
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

**Google Calendar staging層完成**
- dbtモデル 4件 + 25テストパス
- seedsスキーマ追加（google_calendar_event_color_names）
- generate_schema_nameマクロ追加

**バグ修正**
- OAuth 2.0トークンリフレッシュの処理順序修正（calendar_id取得前にリフレッシュ実行）
- 並列実行時のリフレッシュ重複防止（キャッシュウォーム）

**GitHub Actions**
- ワークフロー名を統一（[Service] Fetch形式）
- sync-daily.ymlのインポートパス修正

**管理画面改善**
- 実行中時間の滑らかな表示（1秒更新、ElapsedTimeコンポーネント）
- GitHub Actions使用量表示改善
  - timing APIで正確な実行時間取得
  - 分表示に統一（2,000分）
  - タイムゾーン対応（クライアント側でローカルTZ計算）
- ワークフローマッピング修正

**バックログ追加**
- 同期処理のServerless移行検討（UX改善のため）

### 2025-12-04

- Toggl Track staging層完成（9モデル + 47テスト）
- dbt プロジェクト初期化

### 2025-12-XX（過去）

- 8サービスの同期実装完了
- 管理コンソール実装
- GitHub Actions ワークフロー整備
- ドキュメント整備
