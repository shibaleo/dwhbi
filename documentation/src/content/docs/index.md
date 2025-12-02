---
title: LIFETRACER
description: Personal Data Warehouse Platform - 60年運用を目指す個人データ基盤
---

## クイックリンク

| 目的 | ドキュメント |
|------|------------|
| **次に何をすべきか知りたい** | [ロードマップ](./roadmap) |
| **システム全体像を理解したい** | [アーキテクチャ概要](./architecture/overview) |
| **同期を実行したい** | [運用手順書](./operations/runbook) |
| **テーブル定義を確認したい** | [テーブル定義書](./database/table-design) |

## プロジェクト概要

**LIFETRACER** は個人の生活データ（健康・時間・支出）を統合し、長期運用に耐える分析基盤を提供する。

### 設計思想

| 原則 | 説明 |
|------|------|
| **60年運用** | PostgreSQL + Python + dbt は枯れた技術スタック |
| **テンプレート提供** | ユーザーが全リソースを所有し、提供者への依存なく運用可能 |
| **サービス非依存** | core層以降ではサービス名が消え、将来の移行に耐える |

### 現在のステータス

```
Phase 1: データ収集基盤  ✅ 完了
Phase 2: 本番運用       🔄 進行中
Phase 3: DWH構築       ⏳ 未着手
Phase 4: 可視化        ⏳ 未着手
```

## 実装済みデータソース

| サービス | ドメイン | 認証方式 | ステータス |
|---------|---------|---------|:----------:|
| [Toggl Track](./data-sources/toggl) | 時間管理 | Basic Auth | ✅ 運用中 |
| [Google Calendar](./data-sources/gcalendar) | 時間管理 | Service Account | ✅ 運用中 |
| [Zaim](./data-sources/zaim) | 支出管理 | OAuth 1.0a | ✅ テスト済 |
| [Fitbit](./data-sources/fitbit) | 健康管理 | OAuth 2.0 | ✅ テスト済 |
| [Tanita](./data-sources/tanita) | 健康管理 | OAuth 2.0 | ✅ テスト済 |
| [Trello](./data-sources/trello) | タスク管理 | API Key | ✅ 実装完了 |
| [TickTick](./data-sources/ticktick) | タスク管理 | OAuth 2.0 | ✅ 実装完了 |
| [Airtable](./data-sources/airtable) | マスタ管理 | PAT | ✅ 実装完了 |

**コード統計**: ~5160行 / 131テスト / カバレッジ ~90%

## 技術スタック

| レイヤー | 技術 | ステータス |
|---------|------|:----------:|
| データ収集 | Python 3.12+ | ✅ |
| データ変換 | dbt (SQL) | ⏳ |
| データベース | Supabase (PostgreSQL) | ✅ |
| ジョブ実行 | GitHub Actions | ⏳ |
| 可視化 | Grafana Cloud | ⏳ |
| 暗号化 | AES-256-GCM | ✅ |
