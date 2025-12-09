---
title: "Phase 8: GitHub Actions 整理"
description: GitHub ActionsをCI/CD専用に整理
---

# Phase 8: GitHub Actions 整理

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | GitHub Actions を CI/CD 専用に整理、同期ワークフローを削除 |
| 前提条件 | Phase 7 完了（cron で同期が動作） |
| 成果物 | CI/CD 専用のワークフロー構成 |
| 想定作業 | ワークフローファイルの整理 |

---

## 現状と目標

### 現在のワークフロー構成

```
.github/workflows/
├── sync-toggl.yml       # 同期用（削除対象）
├── sync-gcal.yml        # 同期用（削除対象）
├── sync-daily.yml       # 同期用（削除対象）
├── dbt-run.yml          # 同期用（削除対象）
├── ci.yml               # CI（維持）
└── ...
```

### 目標のワークフロー構成

```
.github/workflows/
├── ci.yml               # テスト、lint、typecheck
├── deploy-vm.yml        # VM へのデプロイ（新規、オプション）
└── deploy-vercel.yml    # Vercel デプロイ（オプション、自動の場合不要）
```

---

## Step 8.1: 現在のワークフロー確認

**目的:** 削除対象と維持対象を特定

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 8.1.1 | ワークフロー一覧 | `ls .github/workflows/` | ⬜ |
| 8.1.2 | 各ファイルの目的確認 | 内容を確認 | ⬜ |
| 8.1.3 | 削除対象リスト作成 | 同期関連を特定 | ⬜ |

### 分類基準

| 分類 | 基準 | 対応 |
|------|------|------|
| 削除 | 同期実行（Toggl, GCal, dbt） | ファイル削除 |
| 維持 | CI（test, lint, typecheck） | そのまま |
| 更新 | 設定が古い CI | 内容更新 |
| 新規 | VM デプロイ | 作成（オプション） |

---

## Step 8.2: 同期ワークフロー削除

**目的:** 同期用ワークフローを削除

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 8.2.1 | sync-toggl.yml 削除 | `git rm` | ⬜ |
| 8.2.2 | sync-gcal.yml 削除 | `git rm` | ⬜ |
| 8.2.3 | sync-daily.yml 削除 | `git rm` | ⬜ |
| 8.2.4 | dbt-run.yml 削除 | `git rm` | ⬜ |

### 削除コマンド

```bash
# 同期関連ワークフロー削除
git rm .github/workflows/sync-toggl.yml
git rm .github/workflows/sync-gcal.yml
git rm .github/workflows/sync-daily.yml
git rm .github/workflows/dbt-run.yml

# 削除確認
git status
```

> **Note:** ファイル名は実際のリポジトリに合わせて調整

---

## Step 8.3: CI ワークフロー整理

**目的:** CI ワークフローを Nx 対応に更新

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 8.3.1 | ci.yml 内容確認 | 現在の設定 | ⬜ |
| 8.3.2 | Nx affected 対応 | 変更のあるパッケージのみテスト | ⬜ |
| 8.3.3 | マトリクス設定 | 複数パッケージ並列実行 | ⬜ |

### ci.yml（更新版）

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # 変更検出
  changes:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.filter.outputs.changes }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check for changes
        id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            connector:
              - 'packages/connector/**'
            console:
              - 'packages/console/**'
            server:
              - 'packages/server/**'
            transform:
              - 'packages/transform/**'
            database-types:
              - 'packages/database-types/**'

  # Lint & Typecheck
  lint:
    runs-on: ubuntu-latest
    needs: changes
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint (affected)
        run: npx nx affected -t lint --base=origin/main~1 --head=HEAD

      - name: Typecheck (affected)
        run: npx nx affected -t typecheck --base=origin/main~1 --head=HEAD

  # Test
  test:
    runs-on: ubuntu-latest
    needs: changes
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Test (affected)
        run: npx nx affected -t test --base=origin/main~1 --head=HEAD

  # Build
  build:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build (affected)
        run: npx nx affected -t build --base=origin/main~1 --head=HEAD
```

---

## Step 8.4: VM デプロイワークフロー作成（オプション）

**目的:** 手動トリガーで VM にデプロイするワークフロー

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 8.4.1 | deploy-vm.yml 作成 | 手動デプロイ用 | ⬜ |
| 8.4.2 | Secrets 設定 | SSH キー等 | ⬜ |

### deploy-vm.yml

```yaml
# .github/workflows/deploy-vm.yml
name: Deploy to VM

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'production'
        type: choice
        options:
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}

    steps:
      - name: Deploy to VM
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VM_HOST }}
          username: ${{ secrets.VM_USER }}
          key: ${{ secrets.VM_SSH_KEY }}
          script: |
            cd /opt/supabase-sync-jobs
            git pull origin main
            cd infra
            docker compose build
            docker compose up -d
            docker compose ps
```

### Secrets 設定

| Secret 名 | 内容 |
|-----------|------|
| `VM_HOST` | VM の Public IP またはホスト名 |
| `VM_USER` | `ubuntu` |
| `VM_SSH_KEY` | SSH 秘密鍵の内容 |

---

## Step 8.5: ワークフロー削除の確認

**目的:** 削除したワークフローが GitHub Actions で表示されないことを確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 8.5.1 | 変更をコミット | `git commit` | ⬜ |
| 8.5.2 | main に push | `git push` | ⬜ |
| 8.5.3 | Actions タブ確認 | 削除したワークフローが消えている | ⬜ |

### コミット

```bash
git add .github/workflows/
git commit -m "chore: remove sync workflows, GitHub Actions is now CI/CD only

- Remove sync-toggl.yml, sync-gcal.yml, sync-daily.yml, dbt-run.yml
- Sync is now handled by cron on OCI VM
- Update ci.yml with Nx affected commands
- Add deploy-vm.yml for manual deployment (optional)
"

git push origin main
```

---

## Step 8.6: README 更新

**目的:** CI/CD の変更をドキュメントに反映

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 8.6.1 | README.md 確認 | Actions の説明があれば更新 | ⬜ |
| 8.6.2 | CONTRIBUTING.md 確認 | CI の説明があれば更新 | ⬜ |

### README.md 更新例

```markdown
## CI/CD

GitHub Actions は CI/CD 専用です:

- **CI**: `ci.yml` - テスト、lint、typecheck（PR / main push）
- **Deploy**: `deploy-vm.yml` - VM へのデプロイ（手動トリガー）

データ同期は OCI VM 上の cron で実行されます。
```

---

## Step 8.7: 最終確認

**目的:** すべての変更が正しく反映されていることを確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 8.7.1 | PR 作成 | 変更内容の確認 | ⬜ |
| 8.7.2 | CI 実行確認 | ci.yml が正常動作 | ⬜ |
| 8.7.3 | 削除されたワークフローが表示されない | Actions タブ | ⬜ |

---

## 完了チェックリスト

- [ ] 同期ワークフロー（sync-*.yml, dbt-run.yml）が削除された
- [ ] `ci.yml` が Nx affected コマンドを使用している
- [ ] `deploy-vm.yml` が作成された（オプション）
- [ ] GitHub Actions タブで削除したワークフローが表示されない
- [ ] CI が正常に動作する（PR で確認）
- [ ] README/ドキュメントが更新された
- [ ] Git コミット完了

---

## GitHub Actions の最終構成

```
.github/workflows/
├── ci.yml              # CI: test, lint, typecheck, build (affected)
└── deploy-vm.yml       # Deploy: manual trigger → VM
```

| ワークフロー | トリガー | 内容 |
|-------------|---------|------|
| ci.yml | push/PR to main | Nx affected でテスト・ビルド |
| deploy-vm.yml | 手動 | VM に SSH デプロイ |

---

## 補足: 同期の移行確認

同期が cron に完全移行されたことを確認:

| 項目 | GitHub Actions (旧) | OCI VM cron (新) |
|------|---------------------|------------------|
| Toggl 同期 | ❌ 削除 | ✅ 01:00 JST |
| GCal 同期 | ❌ 削除 | ✅ 01:05 JST |
| dbt 変換 | ❌ 削除 | ✅ 02:00 JST |
| レポート生成 | ❌ なし | ✅ 03:00 JST |

---

## 次のステップ

→ [Phase 9: 統合テスト・ドキュメント整備](./infra-phase-9-integration-test)
