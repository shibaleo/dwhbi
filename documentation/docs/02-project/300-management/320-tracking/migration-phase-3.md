---
title: "Phase 3: 既存プロジェクトの移行"
description: 既存コードを packages/ へ移動する移行フェーズ
---

# Phase 3: 既存プロジェクトの移行

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | 既存コードを `packages/` へ移動 |
| 前提条件 | Phase 2 完了 |
| 成果物 | `packages/connector/`, `packages/console/`, `packages/transform/`, `documentation/project.json` |

**注意:** connector は現在 Python で実装されている。Phase 8 で Node.js + TypeScript へトランスレーションする予定。

## タスク一覧

---

## 3.1 connector（pipelines から移行）

現在 Python プロジェクトとして移行。Node.js + TypeScript への変換は Phase 8 で実施。

### 3.1.1 ディレクトリ移動

```bash
# Git 履歴を保持して移動
git mv pipelines packages/connector
```

### 3.1.2 project.json 作成

```json
// packages/connector/project.json
{
  "name": "connector",
  "projectType": "application",
  "sourceRoot": "packages/connector",
  "targets": {
    "sync": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "python -m services.{service}"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "pytest tests/"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "ruff check ."
      }
    }
  },
  "tags": ["scope:connector", "type:app", "lang:python"]
}
```

### 3.1.3 テスト移動

```bash
# 既存テストを tests/ へ移動
mkdir -p packages/connector/tests
git mv tests/pipelines/* packages/connector/tests/
```

### 3.1.4 pyproject.toml 作成

```toml
# packages/connector/pyproject.toml
[project]
name = "connector"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "supabase>=2.0.0",
    "python-dotenv>=1.0.0",
    "httpx>=0.25.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "ruff>=0.1.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

---

## 3.2 console

### 3.2.1 ディレクトリ移動

```bash
git mv console packages/console
```

### 3.2.2 project.json 作成

```json
// packages/console/project.json
{
  "name": "console",
  "projectType": "application",
  "sourceRoot": "packages/console/src",
  "targets": {
    "dev": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/console",
        "command": "npm run dev"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/console",
        "command": "npm run build"
      }
    },
    "start": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/console",
        "command": "npm run start"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/console",
        "command": "npm run lint"
      }
    }
  },
  "tags": ["scope:console", "type:app"],
  "implicitDependencies": ["database-types"]
}
```

### 3.2.3 package.json 更新

```json
// packages/console/package.json に name を追加・更新
{
  "name": "@repo/console",
  // ... 既存の設定を維持
}
```

---

## 3.3 transform（dbt）

### 3.3.1 ディレクトリ移動

```bash
git mv transform packages/transform
```

### 3.3.2 project.json 作成

```json
// packages/transform/project.json
{
  "name": "transform",
  "projectType": "application",
  "sourceRoot": "packages/transform",
  "targets": {
    "run": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "dbt run"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "dbt test"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "dbt compile"
      }
    },
    "seed": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "dbt seed"
      }
    },
    "docs": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": "dbt docs generate && dbt docs serve"
      }
    }
  },
  "tags": ["scope:transform", "type:app", "lang:dbt"]
}
```

**注意:** dbt コマンドはルートの `.venv` またはグローバルインストールを使用。

---

## 3.4 documentation

documentation はルート直下に維持し、project.json のみ追加。

### 3.4.1 project.json 作成

```json
// documentation/project.json
{
  "name": "documentation",
  "projectType": "application",
  "sourceRoot": "documentation/src",
  "targets": {
    "dev": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "documentation",
        "command": "npm run dev"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "documentation",
        "command": "npm run build"
      }
    },
    "preview": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "documentation",
        "command": "npm run preview"
      }
    }
  },
  "tags": ["scope:documentation", "type:app"]
}
```

### 3.4.2 package.json 更新

```json
// documentation/package.json に name を追加
{
  "name": "@repo/documentation",
  // ... 既存の設定
}
```

---

## 検証手順

### 各プロジェクトの動作確認

```bash
# connector (Python)
npx nx test connector

# console
npx nx dev console
npx nx build console

# transform
npx nx run transform:build
npx nx run transform:test

# documentation
npx nx dev documentation
npx nx build documentation
```

### 依存グラフ確認

```bash
npx nx graph
```

すべてのプロジェクトが表示されることを確認。

### チェックリスト

- [ ] `packages/connector/` が正しく移行されている（Python）
- [ ] `packages/console/` が正しく移行されている
- [ ] `packages/transform/` が正しく移行されている
- [ ] `documentation/project.json` が作成されている
- [ ] 各プロジェクトの build/test が成功する
- [ ] `npx nx graph` で依存関係が正しく表示される

## ロールバック手順

```bash
# 移動を元に戻す
git mv packages/connector pipelines
git mv packages/console console
git mv packages/transform transform

# project.json を削除
rm documentation/project.json

# Git でリセット
git checkout HEAD~1
```

## 完了条件

以下がすべて満たされたら Phase 3 完了:

1. 4つのプロジェクトが正しい場所に配置されている
2. 各プロジェクトに `project.json` がある
3. 各プロジェクトの build/test が成功する
4. Git 履歴が保持されている

## 次のフェーズ

[Phase 4: 新規プロジェクト作成](/02-project/300-management/320-tracking/migration-phase-4)

## 関連ドキュメント

- [モノレポ移行計画](/02-project/300-management/310-planning/migration-plan) - 全体計画
- [Phase 2: 共有ライブラリ作成](/02-project/300-management/320-tracking/migration-phase-2) - 前のフェーズ
- [Phase 8: connector の TypeScript 移行](/02-project/300-management/320-tracking/migration-phase-8) - connector の言語移行
