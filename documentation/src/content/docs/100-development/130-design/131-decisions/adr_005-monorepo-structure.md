---
title: ADR-005 モノレポ構成
description: 複数プロジェクトを単一リポジトリで管理する構成の設計決定
---

# ADR-005: モノレポ構成

## ステータス

採用（2025-12-07）

## コンテキスト

本リポジトリは複数の技術スタック（Node.js/TypeScript、Python、dbt、Typst）で構成される。各プロジェクトの責務と依存関係を明確にし、独立した開発・デプロイを可能にする必要がある。

## 決定

**各プロジェクトを自己完結型に分離**し、以下の構成を採用する。

### ディレクトリ構成

```
supabase-sync-jobs/
├── .github/                 # GitHub Actions（全体）
├── .env                     # 共通環境変数（DB接続情報等）
├── nx.json                  # Nx 設定
├── package.json             # ルート package.json
├── README.md
│
├── packages/                # 全プロジェクト（フラット構成）
│   ├── connector/           # Node.js + TypeScript - Extract/Load
│   │   ├── project.json
│   │   ├── package.json
│   │   ├── .env
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   └── __tests__/
│   │
│   ├── console/             # Node.js (Next.js) - 管理コンソール
│   │   ├── project.json
│   │   ├── package.json
│   │   ├── .env.local
│   │   ├── src/
│   │   └── __tests__/
│   │
│   ├── transform/           # dbt - Transform
│   │   ├── project.json
│   │   ├── pyproject.toml
│   │   ├── .env
│   │   ├── .venv/
│   │   ├── dbt_project.yml
│   │   ├── profiles.yml
│   │   ├── models/
│   │   ├── seeds/
│   │   └── tests/
│   │
│   ├── analyzer/            # Python - ML予測分析
│   │   ├── project.json
│   │   ├── pyproject.toml
│   │   ├── .env
│   │   ├── .python-version
│   │   ├── .venv/
│   │   ├── src/analyzer/
│   │   ├── notebooks/
│   │   └── tests/
│   │
│   ├── adjuster/            # Python - 調整提案
│   │   ├── project.json
│   │   ├── pyproject.toml
│   │   ├── .env
│   │   ├── .python-version
│   │   ├── .venv/
│   │   ├── src/adjuster/
│   │   └── tests/
│   │
│   ├── reporter/            # Typst + CeTZ - PDF レポート生成
│   │   ├── project.json
│   │   ├── package.json
│   │   ├── .env
│   │   ├── templates/
│   │   ├── src/
│   │   └── output/
│   │
│   ├── visualizer/          # Grafana - 日常可視化
│   │   ├── project.json
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   ├── provisioning/
│   │   │   ├── datasources/
│   │   │   └── dashboards/
│   │   └── dashboards/
│   │
│   └── database-types/      # Supabase 型定義（共有ライブラリ）
│       ├── project.json
│       ├── package.json
│       └── src/
│           ├── index.ts
│           └── database.ts
│
├── tests/                   # 総合テスト（プロジェクト横断 E2E・統合）
│   ├── e2e/
│   └── integration/
│
├── documentation/           # Node.js (Astro) - ドキュメント
│   ├── project.json
│   ├── package.json
│   └── src/
│
└── supabase/                # Supabase マイグレーション・型生成
    ├── config.toml
    ├── migrations/
    └── seed.sql
```

### プロジェクト一覧

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

### 命名規則

プロジェクト名は役割を表す名詞形で統一:

| プロジェクト | 役割 |
|-------------|------|
| connector | データを 外部 API と「接続する」もの |
| transform | データを「変換する」処理（dbt 慣習に従い動詞形） |
| analyzer | データを「分析・予測する」もの |
| adjuster | データを「調整する」もの |
| reporter | データを「報告する」もの |
| visualizer | データを「可視化する」もの |

### 設計原則

#### 1. 自己完結型プロジェクト

各プロジェクトは独自の:
- パッケージマネージャ設定（`pyproject.toml` / `package.json`）
- 仮想環境（`.venv` / `node_modules`）
- 環境変数（`.env`）
- テストディレクトリ
- Nx プロジェクト設定（`project.json`）

を持ち、単独で開発・テスト・実行できる。

#### 2. テストの階層化

| レベル | 場所 | スコープ |
|--------|------|----------|
| 単体テスト | 各プロジェクト `tests/` | 関数・クラス単位 |
| 結合テスト | 各プロジェクト `tests/` | プロジェクト内モジュール連携 |
| 総合テスト | ルート `tests/` | プロジェクト横断（E2E） |

#### 3. 共有リソースの管理

- **ルート `.env`**: DB 接続情報等、全プロジェクト共通の環境変数
- **各プロジェクト `.env`**: ランタイム固有の環境変数（API キー、ポート等）
- **`supabase/migrations/`**: DB スキーマは全プロジェクト共通
- **`libs/database-types/`**: Supabase 型定義を共有

### モノレポ管理

#### Nx の採用

| ツール | 採用理由 |
|--------|----------|
| **Nx** | 成熟したエコシステムと豊富なプラクティス。タスクキャッシュ・依存グラフ・影響範囲分析が標準装備。多言語対応でカスタムエグゼキュータにより Python プロジェクトも統合管理可能 |

**Nx の主な機能:**

| 機能 | 説明 |
|------|------|
| タスクキャッシュ | ビルド・テスト結果をキャッシュし、変更がない場合はスキップ |
| 依存グラフ | プロジェクト間の依存関係を可視化 |
| 影響範囲分析 | 変更されたファイルに基づき、影響を受けるプロジェクトのみ実行 |
| カスタムエグゼキュータ | Python/dbt など非 Node.js プロジェクトも統合 |
| ジェネレータ | 新規プロジェクト・コンポーネントのスキャフォールド |

#### Nx 設定

```json
// nx.json
{
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true
    },
    "test": {
      "cache": true
    },
    "lint": {
      "cache": true
    }
  },
  "namedInputs": {
    "default": ["{projectRoot}/**/*"],
    "production": ["default", "!{projectRoot}/**/*.spec.ts"]
  },
  "affected": {
    "defaultBase": "main"
  }
}
```

#### プロジェクト設定例

```json
// packages/connector/project.json
{
  "name": "connector",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "outputPath": "dist/packages/connector",
        "main": "packages/connector/src/main.ts",
        "tsConfig": "packages/connector/tsconfig.json"
      }
    },
    "serve": {
      "executor": "@nx/js:node",
      "options": {
        "buildTarget": "connector:build"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "packages/connector/jest.config.ts"
      }
    }
  }
}
```

```json
// packages/transform/project.json
{
  "name": "transform",
  "projectType": "application",
  "targets": {
    "run": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "source .venv/bin/activate && dbt run"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "source .venv/bin/activate && dbt test"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "source .venv/bin/activate && dbt compile"
      }
    }
  }
}
```

### 共有型定義

#### 型共有の重要度

| プロジェクト | 重要度 | 理由 |
|-------------|--------|------|
| connector | **高** | Supabase DB型（Insert/Update）、外部 API レスポンス型 |
| analyzer | **高** | Supabase DB型（Select/Insert）、予測結果型 |
| console | **高** | Supabase DB型（全操作）、API型 |
| reporter | 中 | データ取得時に DB型を使用 |
| transform | 低 | dbt は SQL。メタデータ参照時のみ |
| visualizer | 低 | Grafana は直接 SQL クエリ |

#### packages/database-types の構成

```typescript
// packages/database-types/src/index.ts
export * from './database'
export * from './extensions'

// packages/database-types/src/database.ts
// supabase gen types typescript --local > src/database.ts で生成

// packages/database-types/src/extensions.ts
// カスタム型（Enum のラベル、ユーティリティ型等）
```

#### 各プロジェクトからの参照

tsconfig.json の paths で参照:

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "paths": {
      "@repo/database-types": ["packages/database-types/src/index.ts"]
    }
  }
}
```

### Supabase CLI の運用

#### 型生成ワークフロー

```bash
# supabase/ ディレクトリで実行
cd supabase

# ローカル Supabase から型生成
supabase gen types typescript --local > ../packages/database-types/src/database.ts

# または本番から生成
supabase gen types typescript --project-id <project-id> > ../packages/database-types/src/database.ts
```

#### マイグレーション運用

```bash
# 新規マイグレーション作成
supabase migration new <name>

# ローカルに適用
supabase db reset

# 本番に適用
supabase db push
```

#### CI での型チェック

マイグレーション後、型の再生成と型チェックを CI で自動実行:

```yaml
# .github/workflows/typecheck.yml
- name: Generate types
  run: |
    cd supabase
    supabase gen types typescript --local > ../packages/database-types/src/database.ts
- name: Type check
  run: npx nx run-many --target=typecheck --all
```

## 技術選定

### コネクタ（外部API → Raw層）

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Node.js + TypeScript | Python, Deno | 非同期処理が言語の強み。型安全性が実行時まで保証される。Next.js 管理画面と型定義を共有可能。Deno は Edge Functions 前提の選定だったが不要になった。Python は dbt/ML と同一言語である必要がないと判明 |

### データ変換（Raw → Core → Marts）

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| dbt | Python スクリプト, SQLMesh | SQL ベースで可読性が高い。テスト・ドキュメント生成が組込み。4層アーキテクチャとの親和性。既に実装済みで安定稼働 |

### データ分析（予測・介入）

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Python | R, Julia | LightGBM 等の ML ライブラリが充実。データサイエンスのデファクト。分析結果は Supabase に保存するため他領域との言語統一は不要 |

### 管理画面

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Next.js | SvelteKit, Remix, Nuxt | Supabase との公式連携が強力（Auth, Realtime）。コネクタ・レポートと TypeScript 型定義を共有可能。エコシステムの成熟度 |

### データベース管理

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Supabase CLI | Prisma, raw SQL | マイグレーション管理とローカル開発環境の構築が統合。RLS ポリシー管理が容易。Supabase プラットフォームとの一貫性 |

### レポート機能（PDF生成）

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Typst + CeTZ | LaTeX + TikZ, WeasyPrint, PDFKit + D3.js | 日次生成に LaTeX のコンパイル時間は致命的。CeTZ は TikZ コア機能相当の描画力。組版品質は LaTeX 級。既存の LaTeX 知識が活きる。データは Supabase に残るため描画技術の60年保持は不要 |

### 可視化（日常確認）

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Grafana | Metabase, Superset, 自作ダッシュボード | リアルタイム確認と定期 PDF の責務分離。Supabase PostgreSQL への直接接続。アラート機能。PDF 生成の負荷をなくす |

### モノレポ管理ツール

| 選定 | 他の候補 | 選出理由 |
|------|----------|----------|
| Nx | pnpm workspace, Turborepo, Lerna | 成熟したエコシステムと豊富なプラクティス。タスクキャッシュ・依存グラフ・影響範囲分析が標準装備。カスタムエグゼキュータで Python/dbt も統合管理。Nx Cloud でリモートキャッシュも利用可能 |

### 技術スタック構成図

```
[外部API 8サービス]
        ↓
  Node.js + TypeScript (connector)
        ↓
    [Supabase PostgreSQL]
      Raw層 ← Supabase CLI (supabase)
        ↓
      dbt (transform)
        ↓
    Core/Marts層
        ↓
   ┌────┴────┐
   ↓         ↓
Python    Grafana (visualizer)
(analyzer)   ↓
   ↓      [日常確認・アラート]
[予測結果]
   ↓
Supabase
   ↓
Typst + CeTZ (reporter)
   ↓
[日次PDF]
   ↓
Next.js (console)
```

### 言語分布

| 言語 | 使用箇所 |
|------|----------|
| TypeScript | connector, console, reporter（テンプレート処理） |
| SQL | transform (dbt), supabase |
| Python | analyzer, transform (dbt-core) |
| Typst | reporter（組版・描画） |

## 理由

### プロジェクト分離を選んだ理由

| 観点 | 共有（以前） | 分離（採用） |
|------|-------------|-------------|
| 依存管理 | 競合リスクあり | プロジェクト毎に独立 |
| CI/CD | 全体ビルド必須 | 変更プロジェクトのみ |
| 新規追加 | パターン不明確 | テンプレート化可能 |
| 開発体験 | 設定混乱 | 明確な境界 |

### analyzer と adjuster を分離した理由

| 観点 | 効果 |
|------|------|
| QPI 対応 | Practice と モジュールが 1:1 |
| 責務明確化 | 「予測する」と「調整する」が分離 |
| テスト | 各責務を独立してテスト |
| 変更影響 | estimate ロジック変更が adjuster に直接影響しない |

- **責務の違い**: analyzer は「予測・分析」、adjuster は「調整・介入提案」
- **入出力の違い**: analyzer は Core 層を入力に予測結果を出力、adjuster は予測結果を入力に調整アクションを出力
- **変更頻度の違い**: 予測モデルの改善と調整ロジックの改善は独立して進められる
- **テストの独立性**: 予測精度のテストと調整ロジックのテストを分離できる

### reporter と visualizer を分離した理由

- **責務の違い**: reporter は「記録・保存」、visualizer は「日常確認・アラート」
- **更新頻度**: reporter は日次バッチ、visualizer はリアルタイム
- **技術の違い**: Typst（組版）と Grafana（ダッシュボード）は全く異なる技術
- **運用の独立性**: どちらかに問題があっても他方に影響しない

### Nx を選んだ理由

- **成熟したエコシステム**: 豊富なプラグイン、ドキュメント、コミュニティ
- **多言語対応**: TypeScript だけでなく、カスタムエグゼキュータで Python/dbt も統合
- **高度な機能**: タスクキャッシュ、依存グラフ、影響範囲分析が標準装備
- **スケーラビリティ**: Nx Cloud でリモートキャッシュ、分散実行も可能
- **学習投資の価値**: 豊富なプラクティスを学ぶことで長期的な生産性向上

## 却下した代替案

### 案1: 完全分離（マルチリポジトリ）

```
dwh-connector/
dwh-transform/
dwh-analyzer/
dwh-reporter/
dwh-visualizer/
dwh-console/
```

**却下理由:**
- リポジトリ間の同期が困難
- DB マイグレーションの管理が複雑化
- 小規模プロジェクトには過剰

### 案2: pnpm workspace のみ

**却下理由:**
- タスクキャッシュ・影響範囲分析がない
- Python プロジェクトの統合が困難
- Nx の方がプラクティスが豊富

### 案3: Turborepo

**却下理由:**
- Nx より機能が限定的
- 多言語対応が弱い
- エコシステムが Nx ほど成熟していない

## 開発フロー

```bash
# 初回セットアップ
npm install                           # 依存インストール

# 特定プロジェクトのビルド・テスト
npx nx build connector                # connector をビルド
npx nx test connector                 # connector をテスト
npx nx run transform:run              # dbt run を実行

# 影響を受けるプロジェクトのみ実行
npx nx affected --target=build        # 変更の影響を受けるプロジェクトをビルド
npx nx affected --target=test         # 変更の影響を受けるプロジェクトをテスト

# 全プロジェクト実行
npx nx run-many --target=build --all  # 全プロジェクトをビルド
npx nx run-many --target=test --all   # 全プロジェクトをテスト

# 依存グラフの可視化
npx nx graph                          # ブラウザで依存グラフを表示

# 型の再生成（スキーマ変更後）
cd supabase
supabase gen types typescript --local > ../packages/database-types/src/database.ts
```

## 関連ドキュメント

- [121 リポジトリ構成](/100-development/120-specifications/121-overview/repository-structure)
- [123 推定値計算ロジック](/100-development/120-specifications/123-transform/logic/time/001-estimation) - analyzer プロジェクト構成
- [Nx 公式ドキュメント](https://nx.dev/getting-started/intro)
