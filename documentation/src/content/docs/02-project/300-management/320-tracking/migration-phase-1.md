---
title: "Phase 1: 基盤整備"
description: Nx モノレポの基盤を構築する移行フェーズ
---

# Phase 1: 基盤整備

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | Nx モノレポの基盤を構築 |
| 前提条件 | なし（最初のフェーズ） |
| 成果物 | `nx.json`, `tsconfig.base.json`, `packages/` |

## タスク一覧

### 1.1 Nx 初期化

```bash
# ルートディレクトリで実行
npx nx@latest init
```

**確認事項:**
- [ ] `nx.json` が作成された
- [ ] `package.json` に `nx` が追加された

### 1.2 nx.json 設定

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

**設定の意図:**
- `dependsOn: ["^build"]`: 依存プロジェクトを先にビルド
- `cache: true`: ビルド・テスト結果をキャッシュ
- `defaultBase: "main"`: `nx affected` の比較対象

### 1.3 tsconfig.base.json 作成

```json
// tsconfig.base.json
{
  "compileOnSave": false,
  "compilerOptions": {
    "rootDir": ".",
    "sourceMap": true,
    "declaration": false,
    "moduleResolution": "node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "skipLibCheck": true,
    "skipDefaultLibCheck": true,
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@repo/database-types": ["packages/database-types/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

**設定の意図:**
- `paths`: `@repo/database-types` で型定義パッケージを参照可能に
- `strict: true`: 厳格な型チェック
- `ES2022`: モダンな JavaScript 機能を使用

### 1.4 ルート package.json 更新

```json
// package.json
{
  "name": "supabase-sync-jobs",
  "version": "0.0.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "documentation"
  ],
  "scripts": {
    "build": "nx run-many --target=build --all",
    "test": "nx run-many --target=test --all",
    "lint": "nx run-many --target=lint --all",
    "affected:build": "nx affected --target=build",
    "affected:test": "nx affected --target=test",
    "graph": "nx graph"
  },
  "devDependencies": {
    "nx": "^19.0.0",
    "typescript": "^5.0.0"
  }
}
```

**設定の意図:**
- `workspaces`: npm/yarn ワークスペースで依存関係を共有
- `scripts`: よく使う Nx コマンドをショートカット化

### 1.5 packages/ ディレクトリ作成

```bash
mkdir packages
```

### 1.6 .gitignore 更新

```gitignore
# 既存の設定に追加

# Nx
.nx/
dist/
```

## 検証手順

### 動作確認

```bash
# Nx が正しくインストールされているか
npx nx --version

# 依存グラフが表示されるか（まだ空）
npx nx graph

# キャッシュディレクトリが作成されるか
ls -la .nx/
```

### チェックリスト

- [ ] `npx nx --version` でバージョンが表示される
- [ ] `npx nx graph` がブラウザで開く
- [ ] `packages/` ディレクトリが存在する
- [ ] `tsconfig.base.json` が存在する
- [ ] `nx.json` が正しい設定になっている

## ロールバック手順

問題が発生した場合:

```bash
# Nx 関連ファイルを削除
rm -rf nx.json tsconfig.base.json packages/ .nx/

# package.json から Nx 依存を削除
npm uninstall nx

# Git でリセット
git checkout -- package.json package-lock.json
```

## 完了条件

以下がすべて満たされたら Phase 1 完了:

1. `nx.json` が作成され、正しく設定されている
2. `tsconfig.base.json` が作成され、パスエイリアスが設定されている
3. `package.json` にワークスペース設定が追加されている
4. `packages/` ディレクトリが作成されている
5. `npx nx graph` が正常に動作する

## 次のフェーズ

[Phase 2: 共有ライブラリ作成](/02-project/300-management/310-status/migration-phase-2)

## 関連ドキュメント

- [モノレポ移行計画](/02-project/300-management/310-status/migration-plan) - 全体計画
- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 設計決定
- [Nx 公式ドキュメント](https://nx.dev/getting-started/intro)
