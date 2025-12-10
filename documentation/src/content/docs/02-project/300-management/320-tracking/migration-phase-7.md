---
title: "Phase 7: クリーンアップ"
description: 不要なディレクトリ・ファイルの削除と最終整理
---

# Phase 7: クリーンアップ

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | 不要なディレクトリ・ファイルの削除と最終整理 |
| 前提条件 | Phase 6 完了 |
| 成果物 | クリーンな最終構成、更新された README.md |

## タスク一覧

---

### 7.1 不要ディレクトリの削除

#### 7.1.1 削除対象の確認

以下のディレクトリが不要かどうか確認:

```bash
# 削除前に内容を確認
ls -la admin/
ls -la bin/
ls -la scripts/
```

#### 7.1.2 admin/ 削除

```bash
# 未使用であることを確認してから削除
rm -rf admin/
git add -A
git commit -m "chore: remove unused admin directory"
```

#### 7.1.3 bin/ 削除

```bash
rm -rf bin/
git add -A
git commit -m "chore: remove unused bin directory"
```

#### 7.1.4 scripts/ 統合・削除

必要なスクリプトは各プロジェクトへ移動:

```bash
# 必要なスクリプトを確認
ls scripts/

# 例: connector 用スクリプトを移動
git mv scripts/sync_toggl.sh packages/connector/scripts/

# 残りを削除
rm -rf scripts/
git add -A
git commit -m "chore: consolidate scripts into packages"
```

---

### 7.2 旧テストディレクトリの整理

#### 7.2.1 tests/pipelines/ 削除確認

Phase 3 で移行済みの場合:

```bash
# 空であることを確認
ls tests/pipelines/

# 削除
rm -rf tests/pipelines/
```

---

### 7.3 旧パス参照の確認

#### 7.3.1 コード内の旧パス検索

```bash
# pipelines への参照を検索
grep -r "pipelines/" --include="*.ts" --include="*.py" --include="*.yml"

# transform への参照（packages/transform 以外）を検索
grep -r '"transform/' --include="*.ts" --include="*.json" | grep -v "packages/transform"

# console への参照（packages/console 以外）を検索
grep -r '"console/' --include="*.ts" --include="*.json" | grep -v "packages/console"
```

#### 7.3.2 インポートパスの修正

発見された旧パス参照を修正:

```typescript
// 変更前
import { something } from '../../pipelines/lib/utils'

// 変更後
import { something } from '@repo/connector/lib/utils'
```

#### 7.3.3 設定ファイルの確認

```bash
# GitHub Actions の確認
grep -r "pipelines" .github/workflows/
grep -r "console/" .github/workflows/
grep -r "transform/" .github/workflows/

# 各設定ファイルを packages/ 配下のパスに更新
```

---

### 7.4 .gitignore 更新

#### 7.4.1 ルート .gitignore 確認・更新

```gitignore
# .gitignore

# Dependencies
node_modules/
.venv/

# Build outputs
dist/
.next/
.astro/

# Nx
.nx/

# IDE
.idea/
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*

# Coverage
coverage/

# OS
.DS_Store
Thumbs.db

# Python
__pycache__/
*.pyc
*.pyo
*.egg-info/

# dbt
packages/transform/target/
packages/transform/logs/
packages/transform/dbt_packages/

# Grafana
packages/visualizer/grafana-data/

# Reporter
packages/reporter/output/*.pdf
```

---

### 7.5 README.md 更新

#### 7.5.1 ルート README.md 更新

```markdown
# DWH+BI - 個人データ統合基盤

## 概要

個人の活動データを統合し、予測・可視化・フィードバックを行うシステム。

## アーキテクチャ

```
[外部API] → connector → [Supabase] → transform → [Core層]
                                         ↓
                              analyzer → adjuster
                                         ↓
                              reporter ← visualizer
```

## プロジェクト構成

| プロジェクト | 技術スタック | 責務 |
|-------------|-------------|------|
| connector | Python ※ | 外部 API からデータ取得 |
| console | Next.js | 管理画面 |
| transform | dbt | データ変換 |
| analyzer | Python | ML 予測分析 |
| adjuster | Python | 調整提案 |
| reporter | Typst | PDF レポート生成 |
| visualizer | Grafana | ダッシュボード |
| database-types | TypeScript | 型定義共有 |
| documentation | Astro | ドキュメント |

※ connector は Phase 8 で Node.js + TypeScript に移行予定

## セットアップ

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npx nx dev console

# ビルド
npx nx build connector

# テスト
npx nx test connector

# 全プロジェクトテスト
npx nx run-many --target=test --all
```

## 開発ワークフロー

```bash
# 影響を受けるプロジェクトのみビルド
npx nx affected --target=build

# 依存グラフを表示
npx nx graph

# 型を再生成
npm run gen:types
```

## ドキュメント

- [プロジェクトドキュメント](https://shibaleo.github.io/supabase-sync-jobs/)
- [リポジトリ構成](/documentation/src/content/docs/100-development/120-specifications/121-overview/repository-structure.md)
- [ADR](/documentation/src/content/docs/100-development/130-design/131-decisions/)

## ライセンス

Private
```

---

### 7.6 最終確認

#### 7.6.1 ディレクトリ構成確認

```bash
# 最終的なディレクトリ構成を確認
tree -L 2 -d -I 'node_modules|.venv|.git|.nx|.next|dist|target'
```

期待される構成:

```
supabase-sync-jobs/
├── .github/
│   └── workflows/
├── documentation/
│   └── src/
├── packages/
│   ├── analyzer/
│   ├── adjuster/
│   ├── connector/
│   ├── console/
│   ├── database-types/
│   ├── reporter/
│   ├── transform/
│   └── visualizer/
├── supabase/
│   └── migrations/
└── tests/
    ├── e2e/
    └── integration/
```

#### 7.6.2 Nx グラフ確認

```bash
npx nx graph
```

全プロジェクトが表示され、依存関係が正しいことを確認。

#### 7.6.3 全プロジェクトビルド

```bash
npx nx run-many --target=build --all
```

#### 7.6.4 全プロジェクトテスト

```bash
npx nx run-many --target=test --all
```

---

### 7.7 移行完了タグ作成

```bash
git tag -a v1.0.0-monorepo -m "Monorepo migration complete"
git push origin v1.0.0-monorepo
```

---

## 検証手順

### チェックリスト

- [ ] `admin/` が削除されている
- [ ] `bin/` が削除されている
- [ ] `scripts/` が統合・削除されている
- [ ] 旧パス参照がすべて修正されている
- [ ] `.gitignore` が更新されている
- [ ] `README.md` が更新されている
- [ ] `npx nx graph` で正しい構成が表示される
- [ ] `npx nx run-many --target=build --all` が成功する
- [ ] `npx nx run-many --target=test --all` が成功する

### 最終動作確認

```bash
# すべてのプロジェクトが動作することを確認
npx nx dev console &
npx nx run transform:build
npx nx run analyzer:run --help

# 停止
pkill -f "next dev"
```

## ロールバック手順

移行完了タグから復元:

```bash
git reset --hard v0.x.x  # 移行前のタグ
```

## 完了条件

以下がすべて満たされたら Phase 7（および移行全体）完了:

1. 不要なディレクトリがすべて削除されている
2. 旧パス参照がすべて修正されている
3. README.md が新構成を反映している
4. 全プロジェクトのビルド・テストが成功する
5. 移行完了タグが作成されている

## 移行完了

おめでとうございます！モノレポ移行が完了しました。

### 移行後の運用

- 新規プロジェクト追加: `packages/` に作成し、`project.json` を追加
- 依存関係確認: `npx nx graph`
- 影響範囲確認: `npx nx affected --target=build`
- キャッシュクリア: `npx nx reset`

## 次のフェーズ

[Phase 8: connector の TypeScript 移行](/02-project/300-management/310-status/migration-phase-8)

## 関連ドキュメント

- [モノレポ移行計画](/02-project/300-management/310-status/migration-plan) - 全体計画
- [Phase 6: CI/CD 更新](/02-project/300-management/310-status/migration-phase-6) - 前のフェーズ
- [リポジトリ構成](/01-product/100-development/120-specifications/121-overview/repository-structure) - 新構成の詳細
- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 設計決定
