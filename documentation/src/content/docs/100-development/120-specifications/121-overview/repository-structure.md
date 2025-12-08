---
title: リポジトリ構成
description: プロジェクト全体のディレクトリ構成とファイル配置
---

# リポジトリ構成

## 概要

本リポジトリはモノレポ構成を採用し、複数のプロジェクトを単一リポジトリで管理する。
各プロジェクトは自己完結型で、独自の依存関係・仮想環境・テストを持つ。

設計決定の詳細は [131 ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure) を参照。

## ディレクトリ構成

```
supabase-sync-jobs/
│
├── .github/                     # GitHub Actions ワークフロー
│   └── workflows/
│       ├── sync-*.yml           # データ同期ジョブ
│       ├── dbt-run.yml          # dbt 実行
│       └── deploy-docs.yml      # ドキュメントデプロイ
│
├── .env                         # 共通環境変数
├── README.md                    # プロジェクト概要
│
├── tests/                       # 総合テスト（プロジェクト横断）
│   ├── e2e/                     # E2E テスト
│   └── integration/             # 統合テスト
│
├── console/                     # 管理コンソール（Next.js）
├── documentation/               # ドキュメント（Astro Starlight）
├── supabase/                    # Supabase マイグレーション
├── pipelines/                   # データ取得（Python）
├── transform/                   # データ変換（dbt）
└── analyzer/                    # ML 分析（Python）← 新規予定
```

## プロジェクト一覧

### console/ - 管理コンソール

| 項目 | 内容 |
|------|------|
| 技術 | Next.js, TypeScript, TailwindCSS |
| 役割 | OAuth 認証、Vault 管理、target CRUD |
| パッケージ | `package.json` |
| テスト | `__tests__/` |

```
console/
├── package.json
├── src/
│   ├── app/
│   └── components/
├── __tests__/
└── public/
```

### documentation/ - ドキュメント

| 項目 | 内容 |
|------|------|
| 技術 | Astro, Starlight |
| 役割 | 設計ドキュメント、仕様書 |
| パッケージ | `package.json` |
| デプロイ | GitHub Pages |

```
documentation/
├── package.json
├── astro.config.mjs
└── src/
    └── content/
        └── docs/
            ├── design/          # 設計ドキュメント
            ├── specifications/  # 仕様書
            └── planning/        # ロードマップ
```

### supabase/ - データベース

| 項目 | 内容 |
|------|------|
| 技術 | Supabase, PostgreSQL |
| 役割 | マイグレーション、スキーマ管理 |
| CLI | `supabase` |

```
supabase/
├── config.toml
└── migrations/
    ├── 20251124104425_remote_schema.sql
    ├── ...
    └── 20251204000000_create_gcalendar_raw_tables.sql
```

### pipelines/ - データ取得

| 項目 | 内容 |
|------|------|
| 技術 | Python 3.12+, httpx, supabase-py |
| 役割 | Extract/Load（外部 API → raw スキーマ） |
| パッケージ | `pyproject.toml` |
| 出力 | `raw.*` テーブル |

```
pipelines/
├── pyproject.toml
├── .python-version
├── .venv/
├── src/
│   └── pipelines/
│       ├── db/                  # DB 操作
│       ├── lib/                 # 共通ユーティリティ
│       └── services/            # サービス別同期
│           ├── toggl_track/
│           ├── google_calendar/
│           ├── fitbit.py
│           └── ...
└── tests/
```

### transform/ - データ変換

| 項目 | 内容 |
|------|------|
| 技術 | dbt, PostgreSQL |
| 役割 | Transform（raw → staging → core → marts） |
| パッケージ | `dbt_project.yml` |
| 出力 | `staging.*`, `core.*`, `marts.*` ビュー |

```
transform/
├── dbt_project.yml
├── profiles.yml
├── packages.yml
├── models/
│   ├── staging/                 # ソース別クリーニング
│   │   ├── toggl_track/
│   │   └── google_calendar/
│   ├── core/                    # ビジネスエンティティ
│   └── marts/                   # 分析用（将来）
├── seeds/                       # マスタデータ（CSV）
├── tests/                       # dbt テスト
├── macros/
└── scripts/                     # dbt 実行スクリプト
```

### analyzer/ - ML 分析（新規予定）

| 項目 | 内容 |
|------|------|
| 技術 | Python 3.12+, LightGBM, pandas |
| 役割 | ML 分析（staging/core → analyzer → core） |
| パッケージ | `pyproject.toml` |
| 出力 | `analyzer.*` 中間テーブル、`core.fct_time_daily_estimate` |

```
analyzer/
├── pyproject.toml
├── .python-version
├── .venv/
├── src/
│   └── analyzer/
│       ├── common/              # 共通ユーティリティ
│       │   ├── db.py
│       │   └── config.py
│       └── time/                # 時間ドメイン
│           ├── models/
│           ├── features/
│           └── runner.py
├── transform/                   # analyzer 用 dbt
│   ├── dbt_project.yml
│   ├── models/analyzer/
│   └── seeds/
├── notebooks/                   # 実験・分析
├── tests/
└── scripts/
    └── run_estimate.py
```

### tests/ - 総合テスト

| 項目 | 内容 |
|------|------|
| 役割 | プロジェクト横断の E2E・統合テスト |
| 対象 | pipelines → transform → analyzer の連携 |

```
tests/
├── e2e/
│   └── test_time_pipeline.py    # 時間管理パイプライン E2E
├── integration/
│   └── test_db_connectivity.py  # DB 接続テスト
└── conftest.py
```

## テスト階層

| レベル | 場所 | スコープ | 実行タイミング |
|--------|------|----------|----------------|
| 単体 | `{project}/tests/` | 関数・クラス | 開発時、PR |
| 結合 | `{project}/tests/` | モジュール連携 | PR |
| 総合 | `/tests/` | プロジェクト横断 | マージ後、定期実行 |

## スキーマ構成

各プロジェクトの出力先スキーマ:

```
┌─────────────┬──────────────┬─────────────────────────────────┐
│ プロジェクト │ 出力スキーマ  │ 内容                            │
├─────────────┼──────────────┼─────────────────────────────────┤
│ pipelines   │ raw          │ 外部 API 生データ                │
│ transform   │ staging      │ クリーニング済み（ビュー）        │
│             │ core         │ ビジネスエンティティ（ビュー）    │
│             │ marts        │ 分析用（将来）                   │
│             │ seeds        │ マスタデータ（テーブル）          │
│ analyzer    │ analyzer     │ 分析過程の中間テーブル            │
│             │ core         │ estimate 出力                   │
│ console     │ console      │ ユーザー操作データ               │
└─────────────┴──────────────┴─────────────────────────────────┘
```

## 共有リソース

### .env

全プロジェクトで共有する環境変数:

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
DIRECT_DATABASE_URL=postgresql://...

# 外部サービス API キー
TOGGL_API_TOKEN=xxx
# ...
```

### supabase/migrations/

DB スキーマは全プロジェクト共通。マイグレーションは一元管理。

## 開発フロー

### pipelines 開発

```bash
cd pipelines
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest tests/
```

### transform 開発

```bash
cd transform
dbt deps
dbt run --select staging
dbt test
```

### analyzer 開発

```bash
cd analyzer
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python scripts/run_estimate.py --date 2025-12-07
```

### console 開発

```bash
cd console
npm install
npm run dev
```

## 関連ドキュメント

- [131 ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 設計決定の理由
- [024 DWH 4層アーキテクチャ](/000-foundations/020-philosophy/024-dwh-architecture) - 設計哲学
- [121 DWH技術仕様](/100-development/120-specifications/121-overview/dwh-layers) - スキーマ設計
- [123 推定値計算ロジック](/100-development/120-specifications/123-transform/logic/time/001-estimation) - analyzer 詳細
