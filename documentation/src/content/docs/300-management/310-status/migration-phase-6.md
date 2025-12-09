---
title: "Phase 6: CI/CD 更新"
description: GitHub Actions の Nx 対応を行う移行フェーズ
---

# Phase 6: CI/CD 更新

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | GitHub Actions の Nx 対応 |
| 前提条件 | Phase 5 完了 |
| 成果物 | `.github/workflows/` 更新、Nx キャッシュ設定 |

## タスク一覧

---

### 6.1 メインワークフロー更新

#### 6.1.1 ci.yml 作成

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}

jobs:
  main:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Install dependencies
        run: npm ci

      - name: Set Nx SHAs
        uses: nrwl/nx-set-shas@v4

      - name: Run affected lint
        run: npx nx affected --target=lint --parallel=3

      - name: Run affected test
        run: npx nx affected --target=test --parallel=3

      - name: Run affected build
        run: npx nx affected --target=build --parallel=3
```

#### 6.1.2 affected の仕組み

`nx affected` は変更されたファイルに基づき、影響を受けるプロジェクトのみを実行:

```bash
# main ブランチとの差分で影響を受けるプロジェクトを確認
npx nx affected --target=build --base=main --head=HEAD

# 前回のコミットとの差分
npx nx affected --target=test --base=HEAD~1
```

---

### 6.2 型チェックワークフロー

#### 6.2.1 typecheck.yml 作成

```yaml
# .github/workflows/typecheck.yml
name: Type Check

on:
  push:
    branches: [main]
    paths:
      - 'supabase/migrations/**'
      - 'packages/database-types/**'
  pull_request:
    branches: [main]
    paths:
      - 'supabase/migrations/**'
      - 'packages/database-types/**'

jobs:
  typecheck:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Install dependencies
        run: npm ci

      - name: Start Supabase
        run: |
          cd supabase
          supabase start

      - name: Generate types
        run: |
          cd supabase
          supabase gen types typescript --local > ../packages/database-types/src/database.ts

      - name: Type check
        run: npx nx run-many --target=typecheck --all

      - name: Stop Supabase
        if: always()
        run: |
          cd supabase
          supabase stop
```

---

### 6.3 dbt ワークフロー更新

#### 6.3.1 dbt-run.yml 更新

```yaml
# .github/workflows/dbt-run.yml
name: dbt Run

on:
  workflow_dispatch:
    inputs:
      target:
        description: 'dbt target (run/test/build)'
        required: true
        default: 'run'
        type: choice
        options:
          - run
          - test
          - build
          - seed
  schedule:
    - cron: '0 */6 * * *'  # 6時間ごと

jobs:
  dbt:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Node dependencies
        run: npm ci

      - name: Install Python dependencies
        run: |
          cd packages/transform
          python -m venv .venv
          source .venv/bin/activate
          pip install -e .

      - name: Run dbt
        run: npx nx run transform:${{ github.event.inputs.target || 'run' }}
        env:
          DB_HOST: ${{ secrets.DB_HOST }}
          DB_PORT: ${{ secrets.DB_PORT }}
          DB_NAME: ${{ secrets.DB_NAME }}
          DB_USER: ${{ secrets.DB_USER }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

---

### 6.4 データ同期ワークフロー更新

#### 6.4.1 sync-toggl.yml 更新例

```yaml
# .github/workflows/sync-toggl.yml
name: Sync Toggl

on:
  workflow_dispatch:
  schedule:
    - cron: '0 */4 * * *'  # 4時間ごと

jobs:
  sync:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build connector
        run: npx nx build connector

      - name: Run sync
        run: npx nx run connector:sync-toggl
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          TOGGL_API_TOKEN: ${{ secrets.TOGGL_API_TOKEN }}
```

---

### 6.5 ドキュメントデプロイ更新

#### 6.5.1 deploy-docs.yml 更新

```yaml
# .github/workflows/deploy-docs.yml
name: Deploy Documentation

on:
  push:
    branches: [main]
    paths:
      - 'documentation/**'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build documentation
        run: npx nx build documentation

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: documentation/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

### 6.6 Nx キャッシュ設定

#### 6.6.1 ローカルキャッシュ

```json
// nx.json に追加
{
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx/tasks-runners/default",
      "options": {
        "cacheableOperations": ["build", "lint", "test", "typecheck"]
      }
    }
  }
}
```

#### 6.6.2 GitHub Actions キャッシュ

```yaml
# ワークフローに追加
- name: Cache Nx
  uses: actions/cache@v4
  with:
    path: .nx/cache
    key: nx-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-${{ github.sha }}
    restore-keys: |
      nx-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-
      nx-${{ runner.os }}-
```

#### 6.6.3 Nx Cloud（オプション）

Nx Cloud を使用するとリモートキャッシュが利用可能:

```bash
# Nx Cloud に接続
npx nx connect
```

```yaml
# ワークフローで使用
env:
  NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}
```

---

### 6.7 依存グラフ可視化

#### 6.7.1 PR コメントでグラフを表示

```yaml
# .github/workflows/graph.yml
name: Dependency Graph

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  graph:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Set Nx SHAs
        uses: nrwl/nx-set-shas@v4

      - name: Generate affected graph
        run: |
          npx nx affected --target=build --graph=affected.json || true
          echo "Affected projects:"
          cat affected.json | jq '.tasks[].target.project' 2>/dev/null || echo "No affected projects"

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let message = '## Nx Affected Projects\n\n';

            try {
              const graph = JSON.parse(fs.readFileSync('affected.json', 'utf8'));
              const projects = [...new Set(graph.tasks.map(t => t.target.project))];

              if (projects.length === 0) {
                message += 'No projects affected by this change.';
              } else {
                message += 'The following projects are affected by this change:\n\n';
                projects.forEach(p => message += `- \`${p}\`\n`);
              }
            } catch (e) {
              message += 'Could not determine affected projects.';
            }

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: message
            });
```

---

## 検証手順

### ワークフロー確認

```bash
# ローカルで affected 確認
npx nx affected --target=build --base=main --head=HEAD

# グラフ確認
npx nx graph
```

### GitHub Actions 確認

1. PR を作成して CI ワークフローが実行されることを確認
2. affected が正しく動作することを確認
3. キャッシュが効いていることを確認

### チェックリスト

- [ ] `ci.yml` が作成され、PR で実行される
- [ ] `typecheck.yml` が作成され、型チェックが動作する
- [ ] `dbt-run.yml` が更新され、Nx 経由で実行される
- [ ] `deploy-docs.yml` が更新され、Nx 経由でビルドされる
- [ ] キャッシュが設定されている
- [ ] `nx affected` が正しく動作する

## ロールバック手順

```bash
# 旧ワークフローをバックアップから復元
git checkout HEAD~1 -- .github/workflows/
```

## 完了条件

以下がすべて満たされたら Phase 6 完了:

1. CI ワークフローが Nx 対応されている
2. affected で差分ビルド・テストができる
3. キャッシュが動作している
4. 既存のワークフローが Nx 経由で実行される

## 次のフェーズ

[Phase 7: クリーンアップ](/300-management/310-status/migration-phase-7)

## 関連ドキュメント

- [モノレポ移行計画](/300-management/310-status/migration-plan) - 全体計画
- [Phase 5: テスト構成の整理](/300-management/310-status/migration-phase-5) - 前のフェーズ
- [CI/CD 基準](/200-quality/220-standards/cicd) - CI/CD 基準
