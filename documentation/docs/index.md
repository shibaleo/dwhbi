---
title: DWH+BI ドキュメント
description: 個人データ統合基盤
---

# DWH+BI

複数の外部サービスからデータを収集し、データベースに統合保存・分析するシステム。

## クイックリンク

| カテゴリ | 説明 |
|---------|------|
| [実装状況](./02-project/300-management/320-tracking/implementation) | 各機能の実装状況 |
| [ロードマップ](./02-project/300-management/310-planning/roadmap) | 開発フェーズと進捗 |
| [セットアップ](./01-product/400-operations/410-guides/setup) | 開発環境構築 |

## ドキュメント構成

本ドキュメントは [Dewey Decimal方式 + PMBOK分類](./01-product/100-development/130-design/131-decisions/adr_006-documentation-structure) で整理されている。

| 番号 | 分類 | 内容 |
|------|------|------|
| 000 | [背景・基礎](./01-product/000-foundations/020-philosophy/021-design-philosophy) | 設計思想・背景知識 |
| 100 | [開発](#100-開発) | 要件→仕様→設計 |
| 200 | [品質](#200-品質) | テスト計画・品質基準 |
| 300 | [管理](#300-管理) | 状況・計画・PM |
| 400 | [運用](#400-運用) | ガイド・運用手順 |
| 500 | [セキュリティ](#500-セキュリティ) | 脅威モデル・認証設計 |

---

## 100 開発

### 110 要件定義

| ドキュメント | 説明 |
|-------------|------|
| [業務要件](./01-product/100-development/110-requirements/111-business) | なぜこのシステムが必要か |
| [機能要件](./01-product/100-development/110-requirements/112-functional) | 何を実現するか |
| [非機能要件](./01-product/100-development/110-requirements/113-non-functional) | 品質特性 |

### 120 仕様書

| ドキュメント | 説明 |
|-------------|------|
| [システム概要](./01-product/100-development/120-specifications/121-overview/overview) | アーキテクチャ概要 |
| [リポジトリ構成](./01-product/100-development/120-specifications/121-overview/repository-structure) | モノレポ構成（pipelines, transform, analyzer, console） |
| [DWH 4層設計](./01-product/000-foundations/020-philosophy/024-dwh-architecture) | raw→staging→core→marts |
| [管理コンソール](./01-product/100-development/120-specifications/124-console/console-dashboard) | 管理UI仕様 |

### 130 設計書

| ドキュメント | 説明 |
|-------------|------|
| [システムアーキテクチャ](./01-product/100-development/130-design/architecture) | 技術選定と設計 |
| [データベーススキーマ](./01-product/100-development/130-design/database-schema) | テーブル定義（raw, seeds, staging, core） |
| [ADR一覧](./01-product/100-development/130-design/131-decisions/adr_001-release-strategy) | 設計判断の記録 |

---

## 200 品質

| ドキュメント | 説明 |
|-------------|------|
| [単体テスト](./01-product/200-quality/210-test/unit) | dbt data_tests |
| [結合テスト](./01-product/200-quality/210-test/integration) | レイヤー間整合性 |
| [品質基準](./01-product/200-quality/220-standards/standards) | コーディング規約 |
| [CI/CD](./01-product/200-quality/220-standards/cicd) | GitHub Actions |

---

## 300 管理

| ドキュメント | 説明 |
|-------------|------|
| [実装状況](./02-project/300-management/320-tracking/implementation) | 機能ごとの実装状況 |
| [ロードマップ](./02-project/300-management/310-planning/roadmap) | v0.1.0 MVP → v1.0.0 |
| [変更履歴](./02-project/300-management/320-tracking/changelog) | バージョン履歴 |
| [WBS](./02-project/300-management/330-project/wbs) | 作業分解構造 |

---

## 400 運用

| ドキュメント | 説明 |
|-------------|------|
| [セットアップ](./01-product/400-operations/410-guides/setup) | 開発環境構築 |
| [運用手順書](./01-product/400-operations/410-guides/runbook) | 日常運用・トラブルシューティング |
| [監視設計](./01-product/400-operations/420-runbook/monitoring) | sync_logs、アラート |
| [バックアップ](./01-product/400-operations/420-runbook/backup) | DR計画 |

---

## 500 セキュリティ

| ドキュメント | 説明 |
|-------------|------|
| [脅威モデリング](./01-product/500-security/threat-model) | STRIDE分析 |
| [認証設計](./01-product/500-security/auth-design) | OAuth、Vault、RLS |

---

## プロジェクト構成

```
dwhbi/
├── packages/connector/  # TypeScript - 外部API→raw層
├── packages/transform/  # dbt - raw→staging→core→marts
├── packages/analyzer/   # Python - ML分析（estimate計算）
├── packages/console/    # Next.js - 管理コンソール
└── documentation/       # VitePress - 本ドキュメント
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| データベース | Supabase (PostgreSQL) |
| シークレット | Supabase Vault |
| パイプライン | TypeScript + GitHub Actions |
| データ変換 | dbt Core |
| 管理UI | Next.js 15 + Vercel |
| ドキュメント | VitePress |

## 対応サービス（8サービス）

| サービス | 認証方式 | ドメイン | raw層 | staging層 |
|---------|---------|---------|:-----:|:---------:|
| Toggl Track | API Token | 時間管理 | ✅ | ✅ |
| Google Calendar | OAuth 2.0 | 予定管理 | ✅ | ✅ |
| Fitbit | OAuth 2.0 | 健康管理 | ✅ | ⏳ |
| Zaim | OAuth 1.0a | 家計管理 | ✅ | ⏳ |
| Tanita Health Planet | OAuth 2.0 | 健康管理 | ✅ | ⏳ |
| Trello | API Key + Token | プロジェクト管理 | ✅ | ⏳ |
| TickTick | OAuth 2.0 | タスク管理 | ✅ | ⏳ |
| Airtable | PAT | マスタ管理 | ✅ | ⏳ |

## 現在のステータス

```
v0.1.0 MVP      ██████████████░░░░░░  70%  🔄 進行中
v0.2.0 運用安定  ░░░░░░░░░░░░░░░░░░░░   0%  ⏳ 未着手
v1.0.0 分析基盤  ░░░░░░░░░░░░░░░░░░░░   0%  ⏳ 未着手
```

詳細は [ロードマップ](./02-project/300-management/310-planning/roadmap) を参照。
