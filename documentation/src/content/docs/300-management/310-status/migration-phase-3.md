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

## タスク一覧

---

## 3.1 connector（pipelines から移行）

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
  "sourceRoot": "packages/connector/src",
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "outputPath": "dist/packages/connector",
        "main": "packages/connector/src/main.ts",
        "tsConfig": "packages/connector/tsconfig.json",
        "platform": "node",
        "format": ["cjs"]
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
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["packages/connector/**/*.ts"]
      }
    }
  },
  "tags": ["scope:connector", "type:app"],
  "implicitDependencies": ["database-types"]
}
```

### 3.1.3 package.json 更新

```json
// packages/connector/package.json
{
  "name": "@repo/connector",
  "version": "0.0.0",
  "private": true,
  "main": "./src/main.ts",
  "scripts": {
    "build": "nx build connector",
    "test": "nx test connector",
    "lint": "nx lint connector"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@repo/database-types": "workspace:*",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 3.1.4 tsconfig.json 作成

```json
// packages/connector/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "module": "CommonJS",
    "types": ["node", "jest"]
  },
  "include": ["src/**/*", "__tests__/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 3.1.5 テスト移行

```bash
# 既存テストを __tests__ へ移動
mkdir -p packages/connector/__tests__
git mv tests/pipelines/* packages/connector/__tests__/
```

### 3.1.6 jest.config.ts 作成

```typescript
// packages/connector/jest.config.ts
export default {
  displayName: 'connector',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../coverage/packages/connector'
}
```

### 3.1.7 インポートパス更新

```typescript
// 変更前
import { SomeType } from '../types/database'

// 変更後
import { SomeType } from '@repo/database-types'
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
    "build": {
      "executor": "@nx/next:build",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/packages/console"
      }
    },
    "dev": {
      "executor": "@nx/next:server",
      "options": {
        "buildTarget": "console:build",
        "dev": true
      }
    },
    "serve": {
      "executor": "@nx/next:server",
      "options": {
        "buildTarget": "console:build"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "packages/console/jest.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["packages/console/**/*.{ts,tsx}"]
      }
    }
  },
  "tags": ["scope:console", "type:app"],
  "implicitDependencies": ["database-types"]
}
```

### 3.2.3 package.json 更新

```json
// packages/console/package.json
{
  "name": "@repo/console",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "nx dev console",
    "build": "nx build console",
    "test": "nx test console"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@repo/database-types": "workspace:*",
    "@types/react": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 3.2.4 next.config.js 更新

```javascript
// packages/console/next.config.js
const { composePlugins, withNx } = require('@nx/next')

const nextConfig = {
  nx: {
    svgr: false
  },
  transpilePackages: ['@repo/database-types']
}

module.exports = composePlugins(withNx)(nextConfig)
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
        "command": ".venv/Scripts/activate && dbt run"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": ".venv/Scripts/activate && dbt test"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": ".venv/Scripts/activate && dbt compile"
      }
    },
    "seed": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": ".venv/Scripts/activate && dbt seed"
      }
    },
    "docs": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/transform",
        "command": ".venv/Scripts/activate && dbt docs generate && dbt docs serve"
      }
    }
  },
  "tags": ["scope:transform", "type:app"]
}
```

**注意:** Windows 環境では `.venv/Scripts/activate`、Unix 環境では `source .venv/bin/activate` を使用。

### 3.3.3 pyproject.toml 確認・更新

```toml
# packages/transform/pyproject.toml
[project]
name = "transform"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "dbt-postgres>=1.7.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 3.3.4 profiles.yml 更新

パスが変わるため、環境変数を使用するか相対パスを調整:

```yaml
# packages/transform/profiles.yml
default:
  target: dev
  outputs:
    dev:
      type: postgres
      host: "{{ env_var('DB_HOST') }}"
      port: "{{ env_var('DB_PORT') | int }}"
      user: "{{ env_var('DB_USER') }}"
      password: "{{ env_var('DB_PASSWORD') }}"
      dbname: "{{ env_var('DB_NAME') }}"
      schema: public
      threads: 4
```

### 3.3.5 仮想環境再作成

```bash
cd packages/transform
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -e ".[dev]"
dbt deps
```

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
# connector
npx nx build connector
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

すべてのプロジェクトが表示され、database-types への依存が可視化されることを確認。

### チェックリスト

- [ ] `packages/connector/` が正しく移行されている
- [ ] `packages/console/` が正しく移行されている
- [ ] `packages/transform/` が正しく移行されている
- [ ] `documentation/project.json` が作成されている
- [ ] 各プロジェクトの build/test が成功する
- [ ] `@repo/database-types` からのインポートが動作する
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
4. database-types への依存が正しく解決される
5. Git 履歴が保持されている

## 次のフェーズ

[Phase 4: 新規プロジェクト作成](/300-management/310-status/migration-phase-4)

## 関連ドキュメント

- [モノレポ移行計画](/300-management/310-status/migration-plan) - 全体計画
- [Phase 2: 共有ライブラリ作成](/300-management/310-status/migration-phase-2) - 前のフェーズ
