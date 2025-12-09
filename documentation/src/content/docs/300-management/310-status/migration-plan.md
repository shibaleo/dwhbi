---
title: モノレポ移行計画
description: ADR-005 で定義したモノレポ構成への移行計画
---

# モノレポ移行計画

## 概要

[ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure) で定義した構成へ移行するための計画。

## 現状と目標

### 現在のフォルダ構成

```
supabase-sync-jobs/
├── .claude/
├── .vscode/
├── admin/                    # 削除対象（未使用）
├── bin/                      # 削除対象（未使用）
├── console/                  # → packages/console へ移動
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   └── public/
├── documentation/            # 現状維持（ルート直下）
│   └── src/
│       └── content/
├── pipelines/                # → packages/connector へリネーム・移動
│   ├── db/
│   ├── lib/
│   └── services/
│       ├── google_calendar/
│       └── toggl_track/
├── scripts/                  # 削除または各プロジェクトへ統合
├── supabase/                 # 現状維持
│   ├── migrations/
│   └── templates/
├── tests/                    # プロジェクト横断テスト用に維持
│   └── pipelines/           # → packages/connector/__tests__ へ移動
└── transform/                # → packages/transform へ移動
    ├── analyses/
    ├── macros/
    ├── models/
    │   ├── core/
    │   ├── marts/
    │   └── staging/
    ├── seeds/
    ├── snapshots/
    └── tests/
```

### 目標のフォルダ構成（ADR-005）

```
supabase-sync-jobs/
├── .github/
├── .env
├── nx.json
├── package.json
├── README.md
│
├── packages/                 # 全プロジェクト（フラット構成）
│   ├── connector/            # Node.js + TypeScript - Extract/Load
│   ├── console/              # Next.js - 管理コンソール
│   ├── transform/            # dbt - Transform
│   ├── analyzer/             # Python - ML予測分析
│   ├── adjuster/             # Python - 調整提案
│   ├── reporter/             # Typst + CeTZ - PDF レポート生成
│   ├── visualizer/           # Grafana - 日常可視化
│   └── database-types/       # TypeScript - Supabase 型定義
│
├── tests/                    # 総合テスト（プロジェクト横断 E2E・統合）
│   ├── e2e/
│   └── integration/
│
├── documentation/            # Astro - ドキュメント
│   ├── project.json
│   ├── package.json
│   └── src/
│
└── supabase/                 # Supabase マイグレーション・型生成
    ├── config.toml
    ├── migrations/
    └── seed.sql
```

## 移行フェーズ

### Phase 1: 基盤整備

**目的:** Nx モノレポの基盤を構築

| # | タスク | 詳細 |
|---|--------|------|
| 1.1 | Nx 初期化 | `npx nx init` でルートに Nx を導入 |
| 1.2 | `nx.json` 作成 | ADR-005 の設定を適用 |
| 1.3 | `tsconfig.base.json` 作成 | パス設定含む共通 TypeScript 設定 |
| 1.4 | ルート `package.json` 更新 | ワークスペース設定追加 |
| 1.5 | `packages/` ディレクトリ作成 | 全プロジェクト格納用 |

**成果物:**
- `nx.json`
- `tsconfig.base.json`
- 更新された `package.json`
- `packages/` ディレクトリ

---

### Phase 2: 共有ライブラリ作成

**目的:** 型定義の共有基盤を構築

| # | タスク | 詳細 |
|---|--------|------|
| 2.1 | `packages/database-types/` 作成 | Supabase 型定義プロジェクト |
| 2.2 | 型生成スクリプト整備 | `supabase gen types` の出力先を `packages/database-types/src/database.ts` に変更 |
| 2.3 | `project.json` 作成 | Nx プロジェクト設定 |
| 2.4 | `package.json` 作成 | パッケージ定義 |

**成果物:**
- `packages/database-types/src/index.ts`
- `packages/database-types/src/database.ts`
- `packages/database-types/project.json`
- `packages/database-types/package.json`

---

### Phase 3: 既存プロジェクトの移行

**目的:** 既存コードを `packages/` へ移動

#### 3.1 connector（pipelines から移行）

| # | タスク | 詳細 |
|---|--------|------|
| 3.1.1 | `packages/connector/` 作成 | 新ディレクトリ作成 |
| 3.1.2 | `pipelines/` を移行 | `git mv pipelines packages/connector` |
| 3.1.3 | `project.json` 作成 | Nx プロジェクト設定 |
| 3.1.4 | `package.json` 整理 | 依存関係の分離 |
| 3.1.5 | `tsconfig.json` 作成 | プロジェクト固有の設定 |
| 3.1.6 | テスト移行 | `tests/pipelines/` → `packages/connector/__tests__/` |
| 3.1.7 | インポートパス更新 | `@repo/database-types` への参照 |

#### 3.2 console

| # | タスク | 詳細 |
|---|--------|------|
| 3.2.1 | `packages/console/` へ移動 | `git mv console packages/console` |
| 3.2.2 | `project.json` 作成 | Nx プロジェクト設定 |
| 3.2.3 | `package.json` 更新 | ワークスペース依存に変更 |
| 3.2.4 | インポートパス更新 | `@repo/database-types` への参照 |

#### 3.3 transform（dbt）

| # | タスク | 詳細 |
|---|--------|------|
| 3.3.1 | `packages/transform/` へ移動 | `git mv transform packages/transform` |
| 3.3.2 | `project.json` 作成 | `nx:run-commands` エグゼキュータ |
| 3.3.3 | `.venv` セットアップ | プロジェクト固有の仮想環境 |
| 3.3.4 | `pyproject.toml` 作成 | Poetry/uv 設定 |
| 3.3.5 | `profiles.yml` 更新 | パス変更に対応 |

#### 3.4 documentation

| # | タスク | 詳細 |
|---|--------|------|
| 3.4.1 | `project.json` 作成 | Nx プロジェクト設定（ルート直下に維持） |
| 3.4.2 | `package.json` 更新 | ワークスペース依存に変更 |

**成果物:**
- `packages/connector/` 完全移行
- `packages/console/` 完全移行
- `packages/transform/` 完全移行
- `documentation/` に `project.json` 追加

---

### Phase 4: 新規プロジェクト作成

**目的:** ADR-005 で定義された新規プロジェクトのスケルトン作成

#### 4.1 analyzer

| # | タスク | 詳細 |
|---|--------|------|
| 4.1.1 | `packages/analyzer/` 作成 | Python ML プロジェクト |
| 4.1.2 | `project.json` 作成 | カスタムエグゼキュータ |
| 4.1.3 | `pyproject.toml` 作成 | 依存定義 |
| 4.1.4 | `src/analyzer/` 作成 | パッケージ構造 |
| 4.1.5 | `.python-version` 作成 | Python バージョン指定 |

#### 4.2 adjuster

| # | タスク | 詳細 |
|---|--------|------|
| 4.2.1 | `packages/adjuster/` 作成 | Python 調整提案プロジェクト |
| 4.2.2 | `project.json` 作成 | カスタムエグゼキュータ |
| 4.2.3 | `pyproject.toml` 作成 | 依存定義 |
| 4.2.4 | `src/adjuster/` 作成 | パッケージ構造 |

#### 4.3 reporter

| # | タスク | 詳細 |
|---|--------|------|
| 4.3.1 | `packages/reporter/` 作成 | Typst プロジェクト |
| 4.3.2 | `project.json` 作成 | カスタムエグゼキュータ設定 |
| 4.3.3 | `package.json` 作成 | Node.js ラッパー用 |
| 4.3.4 | `templates/` 作成 | 基本的な Typst テンプレート |

#### 4.4 visualizer

| # | タスク | 詳細 |
|---|--------|------|
| 4.4.1 | `packages/visualizer/` 作成 | Grafana プロジェクト |
| 4.4.2 | `project.json` 作成 | カスタムエグゼキュータ |
| 4.4.3 | `docker-compose.yml` 作成 | Grafana コンテナ設定 |
| 4.4.4 | `provisioning/` 作成 | データソース・ダッシュボード設定 |

**成果物:**
- `packages/analyzer/` スケルトン
- `packages/adjuster/` スケルトン
- `packages/reporter/` スケルトン
- `packages/visualizer/` スケルトン

---

### Phase 5: テスト構成の整理

**目的:** テスト階層の確立

| # | タスク | 詳細 |
|---|--------|------|
| 5.1 | `tests/e2e/` 作成 | プロジェクト横断 E2E テスト |
| 5.2 | `tests/integration/` 作成 | プロジェクト横断統合テスト |
| 5.3 | 各プロジェクトテスト移行 | 単体・結合テストを各プロジェクトへ |
| 5.4 | テスト設定統一 | Jest/pytest 設定の標準化 |

**成果物:**
- `tests/e2e/` ディレクトリ
- `tests/integration/` ディレクトリ
- 各プロジェクトの `__tests__/` または `tests/`

---

### Phase 6: CI/CD 更新

**目的:** GitHub Actions の Nx 対応

| # | タスク | 詳細 |
|---|--------|------|
| 6.1 | ワークフロー更新 | `nx affected` を使用した差分ビルド |
| 6.2 | 型チェックワークフロー | マイグレーション後の型再生成・チェック |
| 6.3 | キャッシュ設定 | Nx キャッシュの GitHub Actions 統合 |
| 6.4 | 依存グラフ可視化 | PR に依存グラフを自動コメント |

**成果物:**
- `.github/workflows/` 更新
- Nx Cloud 設定（オプション）

---

### Phase 7: クリーンアップ

**目的:** 不要なディレクトリ・ファイルの削除

| # | タスク | 詳細 |
|---|--------|------|
| 7.1 | `admin/` 削除 | 未使用ディレクトリ |
| 7.2 | `bin/` 削除 | 未使用ディレクトリ |
| 7.3 | `scripts/` 統合・削除 | 必要なスクリプトは各プロジェクトへ |
| 7.4 | 旧パス参照の確認 | 全体的なパス参照の整合性確認 |
| 7.5 | ドキュメント更新 | README、各種ドキュメントの更新 |

**成果物:**
- クリーンな最終構成
- 更新された README.md

---

## 移行時の注意事項

### Git 履歴の保持

```bash
# ファイル移動時は git mv を使用
git mv pipelines packages/connector
git mv console packages/console
git mv transform packages/transform
```

### 依存関係の段階的移行

1. 新構成のプロジェクトを作成
2. 旧パスからのインポートを新パスに更新
3. 動作確認
4. 旧ディレクトリを削除

### ロールバック手順

各フェーズ完了時にタグを作成:

```bash
git tag -a migration-phase-1 -m "Phase 1: Nx 基盤整備完了"
git tag -a migration-phase-2 -m "Phase 2: 共有ライブラリ作成完了"
# ...
```

問題発生時は該当タグにリセット:

```bash
git reset --hard migration-phase-N
```

---

## 依存関係マップ

```
database-types ← connector
             ← console
             ← reporter
             ← analyzer

transform ← (データ変換後) → analyzer → adjuster

supabase → database-types (型生成)
        → transform (データソース)
        → connector (データ格納先)
```

---

## 検証チェックリスト

各フェーズ完了時に確認:

- [ ] `npx nx graph` で依存グラフが正しく表示される
- [ ] `npx nx run-many --target=build --all` が成功する
- [ ] `npx nx run-many --target=test --all` が成功する
- [ ] `npx nx affected --target=build` が変更プロジェクトのみ実行する
- [ ] 各プロジェクトが単独で `npm run dev` / `python -m` で起動できる

---

## 関連ドキュメント

- [ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 構成の設計決定
- [121 リポジトリ構成](/100-development/120-specifications/121-overview/repository-structure) - 詳細な構成仕様
- [Nx 公式ドキュメント](https://nx.dev/getting-started/intro)
