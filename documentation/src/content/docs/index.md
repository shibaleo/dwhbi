---
title: LIFETRACER ドキュメント
description: 個人データ統合基盤
---

# LIFETRACER

複数の外部サービスからライフログデータを収集し、Supabase に統合保存するシステム。

## クイックリンク

| カテゴリ | 説明 |
|---------|------|
| [実装状況](/status/implementation) | 各機能の実装状況 |
| [ロードマップ](/planning/roadmap) | 開発フェーズと進捗 |
| [運用手順書](/guides/runbook) | 日常運用とトラブルシューティング |

## ドキュメント構成

### 要件定義（WHY / WHAT）

| ドキュメント | 説明 |
|-------------|------|
| [業務要件](/requirements/business) | なぜこのシステムが必要か |
| [機能要件](/requirements/functional) | 何を実現するか |
| [非機能要件](/requirements/non-functional) | 品質特性 |

### 仕様書（WHAT / HOW概要）

| ドキュメント | 説明 |
|-------------|------|
| [システム概要](/specifications/overview) | アーキテクチャ概要 |
| [DWH 4層設計](/specifications/dwh-layers) | raw→staging→core→marts |
| [管理ダッシュボード](/specifications/admin-dashboard) | 管理UI仕様 |
| [認証・セキュリティ](/specifications/security) | 認証方式とセキュリティ |

### サービス仕様

| サービス | ドメイン |
|---------|---------|
| [Toggl Track](/specifications/services/toggl-track) | 時間管理 |
| [Fitbit](/specifications/services/fitbit) | 健康管理 |
| [Zaim](/specifications/services/zaim) | 家計管理 |
| [Google Calendar](/specifications/services/google-calendar) | 予定管理 |
| [Tanita Health Planet](/specifications/services/tanita-health-planet) | 健康管理 |
| [Trello](/specifications/services/trello) | プロジェクト管理 |
| [TickTick](/specifications/services/ticktick) | タスク管理 |
| [Airtable](/specifications/services/airtable) | マスタ管理 |

### 設計書（HOW詳細）

| ドキュメント | 説明 |
|-------------|------|
| [システムアーキテクチャ](/design/architecture) | 技術選定と設計 |
| [データベーススキーマ](/design/database-schema) | テーブル定義 |
| [ADR: リリース戦略](/design/decisions/release-strategy) | バージョニング方針 |

### ガイド

| ドキュメント | 説明 |
|-------------|------|
| [セットアップ](/guides/setup) | 開発環境構築 |
| [運用手順書](/guides/runbook) | 運用とトラブルシューティング |

### 状況・計画

| ドキュメント | 説明 |
|-------------|------|
| [実装状況](/status/implementation) | 機能ごとの実装状況 |
| [変更履歴](/status/changelog) | バージョン履歴 |
| [ロードマップ](/planning/roadmap) | 開発フェーズ |
| [バックログ](/planning/backlog) | 将来の拡張予定 |

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| データベース | Supabase (PostgreSQL) |
| シークレット | Supabase Vault |
| パイプライン | Python 3.12 + GitHub Actions |
| 管理UI | Next.js 15 + Vercel |

## 対応サービス

| サービス | 認証方式 | ドメイン |
|---------|---------|---------|
| Toggl Track | API Token | 時間管理 |
| Trello | API Key + Token | プロジェクト管理 |
| Airtable | PAT | マスタ管理 |
| Fitbit | OAuth 2.0 | 健康管理 |
| Tanita Health Planet | OAuth 2.0 | 健康管理 |
| Google Calendar | OAuth 2.0 | 予定管理 |
| TickTick | OAuth 2.0 | タスク管理 |
| Zaim | OAuth 1.0a | 家計管理 |
