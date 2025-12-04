---
title: 変更履歴
description: バージョンごとの変更内容
---

# 変更履歴

## v0.9.0 (2025-12-05)

### 追加
- Google Calendar staging層（4モデル + 29テスト）
  - stg_google_calendar__events（event_id 重複排除対応）
  - stg_google_calendar__colors
  - stg_google_calendar__calendar_list
  - stg_google_calendar__calendars
- dbt seeds スキーマ（google_calendar_event_color_names）
- dbt generate_schema_name マクロ（カスタムスキーマ対応）

### 変更
- Google Calendar 同期モジュールをリファクタリング（gcalendar.py → google_calendar/）
- Admin Console の OAuth フロー改善
- dbt-run.yml を run_dbt.py ラッパー経由に変更

## v0.8.0 (2025-12-XX)

### 追加
- Airtable 同期対応
- TickTick 同期対応

### 変更
- ドキュメント構成の再編成

## v0.7.0 (2025-12-XX)

### 追加
- Trello 同期対応（ボード、リスト、カード、アクション、チェックリスト）
- 差分同期機能（アクション）

## v0.6.0 (2025-12-XX)

### 追加
- Tanita Health Planet 同期対応
- 体組成データ、血圧データの取得

## v0.5.0 (2025-12-XX)

### 追加
- Fitbit 同期対応
- 睡眠、心拍数、HRV、活動、SpO2データの取得

## v0.4.0 (2025-12-XX)

### 追加
- Google Calendar 同期対応
- サービスアカウント認証

## v0.3.0 (2025-12-XX)

### 追加
- Zaim 同期対応
- OAuth 1.0a 認証フロー

## v0.2.0 (2025-12-XX)

### 追加
- 管理ダッシュボード
- Supabase Vault 連携
- 認証情報の暗号化保管

## v0.1.0 (2025-11-XX)

### 追加
- Toggl Track 同期対応
- 基本的なパイプライン構造
- GitHub Actions ワークフロー
- Supabase セットアップ
