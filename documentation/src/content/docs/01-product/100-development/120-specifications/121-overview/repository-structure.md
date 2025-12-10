---
title: リポジトリ構成
description: プロジェクト全体のディレクトリ構成とファイル配置
---

# リポジトリ構成

## 概要

本リポジトリは Nx によるモノレポ構成を採用し、複数のプロジェクトを単一リポジトリで管理する。
全プロジェクトを `packages/` 配下にフラット配置し、各プロジェクトは自己完結型で独自の依存関係・仮想環境・テストを持つ。

設計決定の詳細は [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure) を参照。

## ディレクトリ構成

```
dwhbi/
├── .github/                 # GitHub Actions（全体）
│   └── workflows/
│       ├── sync-*.yml       # データ同期ジョブ
│       ├── dbt-run.yml      # dbt 実行
│       ├── typecheck.yml    # 型チェック
│       └── deploy-docs.yml  # ドキュメントデプロイ
│
├── .env                     # 共通環境変数（DB接続情報等）
├── nx.json                  # Nx 設定
├── package.json             # ルート package.json
├── tsconfig.base.json       # 共通 TypeScript 設定
├── README.md
│
├── packages/                # 全プロジェクト（フラット構成）
│   ├── connector/           # Node.js + TypeScript - Extract/Load
│   ├── console/             # Next.js - 管理コンソール
│   ├── transform/           # dbt - Transform
│   ├── analyzer/            # Python - ML予測分析
│   ├── adjuster/            # Python - 調整提案
│   ├── reporter/            # Typst + CeTZ - PDF レポート生成
│   ├── visualizer/          # Grafana - 日常可視化
│   └── database-types/      # TypeScript - Supabase 型定義
│
├── tests/                   # 総合テスト（プロジェクト横断 E2E・統合）
│   ├── e2e/
│   └── integration/
│
├── documentation/           # Astro - ドキュメント
│   ├── project.json
│   ├── package.json
│   └── src/
│
└── supabase/                # Supabase マイグレーション・型生成
    ├── config.toml
    ├── migrations/
    └── seed.sql
```

## プロジェクト一覧

| プロジェクト | 技術スタック | 責務 |
|-------------|-------------|------|
| connector | Node.js + TypeScript | 外部 API と接続してデータ取得、Raw 層へ格納 |
| console | Next.js | 管理画面、設定 UI |
| transform | dbt (Python) | Raw → Staging → Core → Marts 変換 |
| analyzer | Python | ML 予測分析、予測結果を Supabase に保存 |
| adjuster | Python | 調整提案、介入アクションを Supabase に保存 |
| reporter | Typst + CeTZ | 日次 PDF レポート生成 |
| visualizer | Grafana | リアルタイムダッシュボード・アラート |
| database-types | TypeScript | Supabase 型定義の共有 |
| documentation | Astro | プロジェクトドキュメント |
| supabase | Supabase CLI | DB マイグレーション・RLS 管理・型生成 |

## 各プロジェクト詳細

### packages/connector - データ取得

| 項目 | 内容 |
|------|------|
| 技術 | Node.js, TypeScript, httpx |
| 役割 | Extract/Load（外部 API → raw スキーマ） |
| パッケージ | `package.json`, `project.json` |
| 出力 | `raw.*` テーブル |

```
packages/connector/
├── project.json
├── package.json
├── .env
├── tsconfig.json
├── src/
│   ├── services/            # サービス別同期
│   │   ├── toggl-track/
│   │   ├── google-calendar/
│   │   └── ...
│   └── lib/                 # 共通ユーティリティ
└── __tests__/
```

### packages/console - 管理コンソール

| 項目 | 内容 |
|------|------|
| 技術 | Next.js, TypeScript, TailwindCSS |
| 役割 | OAuth 認証、Vault 管理、target CRUD |
| パッケージ | `package.json`, `project.json` |
| テスト | `__tests__/` |

```
packages/console/
├── project.json
├── package.json
├── .env.local
├── src/
│   ├── app/
│   └── components/
└── __tests__/
```

### packages/transform - データ変換

| 項目 | 内容 |
|------|------|
| 技術 | dbt, Python, PostgreSQL |
| 役割 | Transform（raw → staging → core → marts） |
| パッケージ | `pyproject.toml`, `project.json` |
| 出力 | `staging.*`, `core.*`, `marts.*` ビュー |

```
packages/transform/
├── project.json
├── pyproject.toml
├── .env
├── .venv/
├── dbt_project.yml
├── profiles.yml
├── models/
│   ├── staging/             # ソース別クリーニング
│   ├── core/                # ビジネスエンティティ
│   └── marts/               # 分析用
├── seeds/                   # マスタデータ（CSV）
└── tests/
```

### packages/analyzer - ML 分析

| 項目 | 内容 |
|------|------|
| 技術 | Python, LightGBM, pandas |
| 役割 | ML 予測分析、予測結果を Supabase に保存 |
| パッケージ | `pyproject.toml`, `project.json` |
| 出力 | `core.fct_time_daily_estimate` 等 |

```
packages/analyzer/
├── project.json
├── pyproject.toml
├── .env
├── .python-version
├── .venv/
├── src/analyzer/
│   ├── common/              # 共通ユーティリティ
│   └── time/                # 時間ドメイン
├── notebooks/               # 実験・分析
└── tests/
```

### packages/adjuster - 調整提案

| 項目 | 内容 |
|------|------|
| 技術 | Python |
| 役割 | 調整提案、介入アクションを Supabase に保存 |
| パッケージ | `pyproject.toml`, `project.json` |

```
packages/adjuster/
├── project.json
├── pyproject.toml
├── .env
├── .python-version
├── .venv/
├── src/adjuster/
└── tests/
```

### packages/reporter - PDF レポート生成

| 項目 | 内容 |
|------|------|
| 技術 | Typst, CeTZ |
| 役割 | 日次 PDF レポート生成 |
| パッケージ | `package.json`, `project.json` |
| 出力 | `output/` |

```
packages/reporter/
├── project.json
├── package.json
├── .env
├── templates/               # Typst テンプレート
├── src/
└── output/
```

### packages/visualizer - リアルタイム可視化

| 項目 | 内容 |
|------|------|
| 技術 | Grafana, Docker |
| 役割 | リアルタイムダッシュボード・アラート |
| パッケージ | `docker-compose.yml`, `project.json` |

```
packages/visualizer/
├── project.json
├── docker-compose.yml
├── .env
├── provisioning/
│   ├── datasources/
│   └── dashboards/
└── dashboards/
```

### packages/database-types - 型定義共有

| 項目 | 内容 |
|------|------|
| 技術 | TypeScript |
| 役割 | Supabase 型定義の共有 |
| パッケージ | `package.json`, `project.json` |

```
packages/database-types/
├── project.json
├── package.json
└── src/
    ├── index.ts             # 再エクスポート
    ├── database.ts          # supabase gen types 出力
    └── extensions.ts        # カスタム型
```

### documentation - ドキュメント

| 項目 | 内容 |
|------|------|
| 技術 | Astro, Starlight |
| 役割 | 設計ドキュメント、仕様書 |
| パッケージ | `package.json`, `project.json` |
| デプロイ | GitHub Pages |

```
documentation/
├── project.json
├── package.json
├── astro.config.mjs
└── src/
    └── content/
        └── docs/
```

### supabase - データベース

| 項目 | 内容 |
|------|------|
| 技術 | Supabase, PostgreSQL |
| 役割 | マイグレーション、スキーマ管理、型生成 |
| CLI | `supabase` |

```
supabase/
├── config.toml
├── migrations/
└── seed.sql
```

### tests - 総合テスト

| 項目 | 内容 |
|------|------|
| 役割 | プロジェクト横断の E2E・統合テスト |
| 対象 | connector → transform → analyzer の連携 |

```
tests/
├── e2e/
│   └── test_time_pipeline.py
├── integration/
│   └── test_db_connectivity.py
└── conftest.py
```

## テスト階層

| レベル | 場所 | スコープ | 実行タイミング |
|--------|------|----------|----------------|
| 単体 | `packages/{project}/__tests__/` or `tests/` | 関数・クラス | 開発時、PR |
| 結合 | `packages/{project}/__tests__/` or `tests/` | モジュール連携 | PR |
| 総合 | `/tests/` | プロジェクト横断 | マージ後、定期実行 |

## スキーマ構成

各プロジェクトの出力先スキーマ:

| プロジェクト | 出力スキーマ | 内容 |
|-------------|-------------|------|
| connector | raw | 外部 API 生データ |
| transform | staging | クリーニング済み（ビュー） |
| transform | core | ビジネスエンティティ（ビュー） |
| transform | marts | 分析用 |
| transform | seeds | マスタデータ（テーブル） |
| analyzer | core | estimate 出力 |
| adjuster | core | 調整アクション出力 |
| console | console | ユーザー操作データ |

## 共有リソース

### .env（ルート）

全プロジェクトで共有する環境変数:

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
DIRECT_DATABASE_URL=postgresql://...
```

### 各プロジェクト .env

プロジェクト固有の環境変数（API キー、ポート等）:

```bash
# packages/connector/.env
TOGGL_API_TOKEN=xxx

# packages/console/.env.local
NEXT_PUBLIC_SUPABASE_URL=xxx
```

### supabase/migrations/

DB スキーマは全プロジェクト共通。マイグレーションは一元管理。

### packages/database-types/

Supabase 型定義を共有。`@repo/database-types` としてインポート:

```typescript
import { Database } from '@repo/database-types';
```

## Nx 開発フロー

### 初回セットアップ

```bash
npm install                           # 依存インストール
```

### 特定プロジェクトのビルド・テスト

```bash
npx nx build connector                # connector をビルド
npx nx test connector                 # connector をテスト
npx nx run transform:run              # dbt run を実行
```

### 影響を受けるプロジェクトのみ実行

```bash
npx nx affected --target=build        # 変更の影響を受けるプロジェクトをビルド
npx nx affected --target=test         # 変更の影響を受けるプロジェクトをテスト
```

### 全プロジェクト実行

```bash
npx nx run-many --target=build --all  # 全プロジェクトをビルド
npx nx run-many --target=test --all   # 全プロジェクトをテスト
```

### 依存グラフの可視化

```bash
npx nx graph                          # ブラウザで依存グラフを表示
```

### 型の再生成（スキーマ変更後）

```bash
cd supabase
supabase gen types typescript --local > ../packages/database-types/src/database.ts
```

## 関連ドキュメント

- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 設計決定の理由
- [モノレポ移行計画](/02-project/300-management/310-status/migration-plan) - 移行計画
- [DWH 4層アーキテクチャ](/01-product/000-foundations/020-philosophy/024-dwh-architecture) - 設計哲学
- [DWH技術仕様](/01-product/100-development/120-specifications/121-overview/dwh-layers) - スキーマ設計
