---
title: インフラ構築・ホスティング計画
description: ADR-007 で定義したインフラ構成の構築計画
---

# インフラ構築・ホスティング計画

## 概要

[ADR-007 インフラストラクチャ配置](/100-development/130-design/131-decisions/adr_007-infrastructure-layout) で定義した構成を構築するための計画。

GitHub Actions での同期実行から OCI VM 上の常駐サーバーへ移行し、GitHub Actions を本来の CI/CD 用途に戻す。

## 現状と目標

### 現在のフォルダ構成

```
supabase-sync-jobs/
├── .github/
│   └── workflows/           # 同期実行に使用中（移行対象）
│
├── packages/
│   ├── connector/           # ✅ Node.js/TS 実装済み（CLI）
│   ├── console/             # ✅ Next.js 実装済み
│   ├── analyzer/            # △ Python スケルトンのみ
│   ├── adjuster/            # △ Python スケルトンのみ
│   ├── reporter/            # △ Node.js + Typst スケルトンのみ
│   ├── transform/           # ✅ dbt 実装済み
│   ├── visualizer/          # △ ローカルDocker設定のみ
│   └── database-types/      # ✅ 型定義
│
├── supabase/                # ✅ マイグレーション管理
│
├── infra/                   # ❌ 存在しない
│   └── (なし)
│
└── packages/server/         # ❌ 存在しない
```

### 現在のインフラ状態

| サービス | 状態 | 備考 |
|---------|------|------|
| Supabase | ✅ 稼働中 | PostgreSQL、認証 |
| GitHub Actions | ✅ 稼働中 | 同期実行に使用中（移行対象） |
| OCI VM | △ 旧VM存在 | superset-vm（削除予定） |
| Cloudflare | ❌ 未設定 | Tunnel未作成 |
| Vercel | ❌ 未デプロイ | console用 |
| Grafana Cloud | ❌ 未設定 | visualizer用 |

### 現在のリクエストフロー（Phase A）

```
console → GitHub Actions dispatch → connector CLI
                                         │
                                         ▼
                                    Supabase
```

### 目標のリクエストフロー（Phase C）

```
console → Vercel Serverless → Cloudflare Tunnel → server (Hono)
                                                      │
                                            ┌─────────┼─────────┐
                                            ▼         ▼         ▼
                                      connector   analyzer   adjuster
                                            │
                                            ▼
                                       Supabase

cron → docker compose run → connector sync / transform dbt run
                                            │
                                            ▼
                                       Supabase
```

---

## 移行フェーズ概要

ADR-007 で定義された移行フェーズ:

| フェーズ | 状態 | 内容 |
|---------|------|------|
| Phase A | ✅ 現在 | GitHub Actions で同期実行 |
| Phase B | 🎯 目標 | 並行運用（GitHub Actions + server API） |
| Phase C | 📅 将来 | server API に完全移行、GitHub Actions は CI/CD 専用 |

本計画は **Phase A → Phase B** への移行を詳細化する。

---

## 詳細計画ドキュメント

各フェーズの詳細な実行計画は以下のドキュメントを参照:

| Phase | ドキュメント | 内容 |
|-------|-------------|------|
| 1 | [OCI VM 準備](./infra-phase-1-oci-vm) | VM作成、SSH接続確立 |
| 2 | [VM 環境構築](./infra-phase-2-vm-setup) | Docker、開発ツールインストール |
| 3 | [infra ディレクトリ作成](./infra-phase-3-infra-directory) | docker-compose.yml、IaC基盤 |
| 4 | [server パッケージ作成](./infra-phase-4-server-package) | Hono API Gateway実装 |
| 5 | [Cloudflare Tunnel 設定](./infra-phase-5-cloudflare-tunnel) | HTTPS アクセス確立 |
| 6 | [console デプロイ](./infra-phase-6-console-deploy) | Vercel デプロイ、Serverless Function |
| 7 | [cron 設定](./infra-phase-7-cron-setup) | 日次レポート生成パイプライン |
| 8 | [GitHub Actions 整理](./infra-phase-8-github-actions) | CI/CD 専用に整理 |
| 9 | [統合テスト・ドキュメント整備](./infra-phase-9-integration-test) | E2E テスト、Phase B 完了 |

---

## 構築タスク概要

以下は各フェーズの概要です。詳細は上記の個別ドキュメントを参照してください。

### Phase 1: OCI VM 準備

**目的:** 新しい VM を作成し、SSH 接続を確立

#### 1.1 既存リソース削除

| # | タスク | 状態 |
|---|--------|------|
| 1.1.1 | superset-vm を Terminate（Boot Volume も削除） | ⬜ |
| 1.1.2 | superset-nsg を削除 | ⬜ |
| 1.1.3 | vcn-20250905-2350 を削除 | ⬜ |

#### 1.2 新規 VM 作成

| # | タスク | 状態 |
|---|--------|------|
| 1.2.1 | VCN 作成: lifetracer-vcn | ⬜ |
| 1.2.2 | VM 作成: lifetracer-vm (VM.Standard.A1.Flex) | ⬜ |
| 1.2.3 | スペック: 4 OCPU / 24 GB RAM | ⬜ |
| 1.2.4 | OS: Ubuntu 24.04 (ARM) | ⬜ |
| 1.2.5 | SSH キー生成・秘密鍵ダウンロード | ⬜ |
| 1.2.6 | Public IP 確認 | ⬜ |

#### 1.3 SSH 接続設定

| # | タスク | 状態 |
|---|--------|------|
| 1.3.1 | 秘密鍵配置: `~/.ssh/oci-lifetracer.pem` | ⬜ |
| 1.3.2 | パーミッション: `chmod 600` | ⬜ |
| 1.3.3 | SSH config 追加 | ⬜ |
| 1.3.4 | 接続テスト: `ssh lifetracer` | ⬜ |

**SSH config:**

```ssh_config
Host lifetracer
  HostName <VM_PUBLIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/oci-lifetracer.pem
```

**成果物:**
- [ ] 稼働中の OCI VM (RUNNING)
- [ ] SSH 接続確立
- [ ] `~/.ssh/config` 更新

---

### Phase 2: VM 環境構築

**目的:** Docker と開発ツールをインストール

#### 2.1 基本パッケージ

| # | タスク | 状態 |
|---|--------|------|
| 2.1.1 | システム更新: `apt update && apt upgrade` | ⬜ |
| 2.1.2 | 基本ツール: git, curl, vim, htop | ⬜ |
| 2.1.3 | タイムゾーン: Asia/Tokyo | ⬜ |

#### 2.2 Docker インストール

| # | タスク | 状態 |
|---|--------|------|
| 2.2.1 | Docker インストール（公式リポジトリ） | ⬜ |
| 2.2.2 | Docker Compose v2 インストール | ⬜ |
| 2.2.3 | ユーザー追加: docker グループ | ⬜ |
| 2.2.4 | 動作確認: `docker run hello-world` | ⬜ |

#### 2.3 VSCode Remote SSH 設定

| # | タスク | 状態 |
|---|--------|------|
| 2.3.1 | ローカル VSCode に Remote-SSH 拡張インストール | ⬜ |
| 2.3.2 | VM 接続テスト | ⬜ |
| 2.3.3 | VM 側に拡張機能インストール（Docker, ESLint等） | ⬜ |

**成果物:**
- [ ] Docker 稼働中
- [ ] VSCode Remote SSH 接続可能

---

### Phase 3: infra ディレクトリ作成

**目的:** Infrastructure as Code の基盤整備

#### 3.1 ディレクトリ構造

| # | タスク | 状態 |
|---|--------|------|
| 3.1.1 | `infra/` 作成 | ⬜ |
| 3.1.2 | `infra/oci/scripts/` 作成 | ⬜ |
| 3.1.3 | `infra/cloudflare/` 作成 | ⬜ |
| 3.1.4 | `infra/vercel/` 作成 | ⬜ |
| 3.1.5 | `infra/README.md` 作成 | ⬜ |

#### 3.2 セットアップスクリプト

| # | タスク | 状態 |
|---|--------|------|
| 3.2.1 | `infra/oci/scripts/setup-vm.sh` 作成 | ⬜ |
| 3.2.2 | `infra/oci/scripts/deploy.sh` 作成 | ⬜ |
| 3.2.3 | `.gitignore` 更新（機密ファイル除外） | ⬜ |

#### 3.3 docker-compose.yml 作成

| # | タスク | 状態 |
|---|--------|------|
| 3.3.1 | `infra/docker-compose.yml` 作成（最小構成） | ⬜ |
| 3.3.2 | `infra/.env.example` 作成 | ⬜ |
| 3.3.3 | ネットワーク定義 | ⬜ |

**目標構造:**

```
infra/
├── README.md
├── docker-compose.yml
├── .env.example
├── crontab
│
├── oci/
│   └── scripts/
│       ├── setup-vm.sh
│       └── deploy.sh
│
├── cloudflare/
│   ├── config.yml.example
│   └── README.md
│
└── vercel/
    └── vercel.json
```

**成果物:**
- [ ] `infra/` ディレクトリ一式
- [ ] セットアップスクリプト
- [ ] docker-compose.yml（最小構成）

---

### Phase 4: server パッケージ作成

**目的:** API ゲートウェイ（Hono）の実装

#### 4.1 プロジェクト作成

| # | タスク | 状態 |
|---|--------|------|
| 4.1.1 | `packages/server/` 作成 | ⬜ |
| 4.1.2 | `package.json` 作成（Hono 依存、`@repo/connector` ワークスペース依存） | ⬜ |
| 4.1.3 | `tsconfig.json` 作成 | ⬜ |
| 4.1.4 | `project.json` 作成（Nx 設定） | ⬜ |

#### 4.2 基本実装

| # | タスク | 状態 |
|---|--------|------|
| 4.2.1 | `src/index.ts` エントリーポイント | ⬜ |
| 4.2.2 | `GET /health` ヘルスチェック | ⬜ |
| 4.2.3 | `@repo/connector` 統合 | ⬜ |
| 4.2.4 | `POST /api/sync/toggl` エンドポイント | ⬜ |
| 4.2.5 | `POST /api/sync/gcal` エンドポイント | ⬜ |

#### 4.3 Dockerfile 作成

| # | タスク | 状態 |
|---|--------|------|
| 4.3.1 | `packages/server/Dockerfile` 作成 | ⬜ |
| 4.3.2 | `.dockerignore` 作成 | ⬜ |
| 4.3.3 | ビルドテスト | ⬜ |

**server API 設計:**

```typescript
// packages/server/src/index.ts
import { Hono } from 'hono'
import { syncToggl, syncGcal } from '@repo/connector'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/api/sync/toggl', async (c) => {
  const result = await syncToggl()
  return c.json(result)
})

app.post('/api/sync/gcal', async (c) => {
  const result = await syncGcal()
  return c.json(result)
})

export default app
```

**成果物:**
- [ ] `packages/server/` 完成
- [ ] Hono API サーバー稼働
- [ ] Dockerfile

---

### Phase 5: Cloudflare Tunnel 設定

**目的:** HTTPS アクセスの確立

#### 5.1 Cloudflare 準備

| # | タスク | 状態 |
|---|--------|------|
| 5.1.1 | ドメイン確認（Cloudflare 管理下） | ⬜ |
| 5.1.2 | VM に cloudflared インストール | ⬜ |
| 5.1.3 | `cloudflared tunnel login` | ⬜ |

#### 5.2 Tunnel 作成

| # | タスク | 状態 |
|---|--------|------|
| 5.2.1 | `cloudflared tunnel create lifetracer` | ⬜ |
| 5.2.2 | DNS ルート設定 | ⬜ |
| 5.2.3 | `config.yml` 作成 | ⬜ |
| 5.2.4 | docker-compose に cloudflared 追加 | ⬜ |

#### 5.3 動作確認

| # | タスク | 状態 |
|---|--------|------|
| 5.3.1 | Tunnel 起動 | ⬜ |
| 5.3.2 | HTTPS アクセス確認 | ⬜ |
| 5.3.3 | `/health` レスポンス確認 | ⬜ |

**config.yml テンプレート:**

```yaml
# infra/cloudflare/config.yml.example
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: api.example.com
    service: http://server:3000
  - service: http_status:404
```

**成果物:**
- [ ] Named Tunnel 稼働
- [ ] HTTPS でアクセス可能
- [ ] `infra/cloudflare/config.yml.example`

---

### Phase 6: console デプロイ（Vercel）

**目的:** 管理 UI を Vercel にデプロイ

#### 6.1 Vercel 準備

| # | タスク | 状態 |
|---|--------|------|
| 6.1.1 | Vercel アカウント確認 | ⬜ |
| 6.1.2 | GitHub リポジトリ連携 | ⬜ |
| 6.1.3 | プロジェクト作成（packages/console） | ⬜ |

#### 6.2 環境変数設定

| # | タスク | 状態 |
|---|--------|------|
| 6.2.1 | `NEXT_PUBLIC_SUPABASE_URL` | ⬜ |
| 6.2.2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ⬜ |
| 6.2.3 | `API_URL`（OCI VM の Tunnel URL） | ⬜ |

#### 6.3 Serverless Function 実装

| # | タスク | 状態 |
|---|--------|------|
| 6.3.1 | `app/api/sync/[service]/route.ts` 作成 | ⬜ |
| 6.3.2 | server API 呼び出し実装 | ⬜ |
| 6.3.3 | デプロイテスト | ⬜ |

**Serverless Function:**

```typescript
// packages/console/src/app/api/sync/[service]/route.ts
export async function POST(
  request: Request,
  { params }: { params: { service: string } }
) {
  const response = await fetch(
    `${process.env.API_URL}/api/sync/${params.service}`,
    { method: 'POST' }
  )
  return response
}
```

**成果物:**
- [ ] console が Vercel で稼働
- [ ] server API 呼び出し動作
- [ ] `infra/vercel/vercel.json`

---

### Phase 7: cron 設定（日次レポート生成）

**目的:** 日次レポート生成のための同期・変換・レポート出力の自動実行

| # | タスク | 状態 |
|---|--------|------|
| 7.1 | `infra/crontab` 作成 | ⬜ |
| 7.2 | VM に crontab 設定 | ⬜ |
| 7.3 | ログ出力設定 | ⬜ |
| 7.4 | 動作確認 | ⬜ |

**crontab:**

```bash
# infra/crontab
# 日次レポート生成パイプライン

# 1. データ同期 (01:00 JST = 16:00 UTC)
0 16 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm connector npm run sync:toggl >> /var/log/sync.log 2>&1
5 16 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm connector npm run sync:gcal >> /var/log/sync.log 2>&1

# 2. dbt transform (02:00 JST = 17:00 UTC)
0 17 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm transform dbt run >> /var/log/dbt.log 2>&1

# 3. レポート生成 (03:00 JST = 18:00 UTC)
0 18 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm reporter npm run generate >> /var/log/reporter.log 2>&1
```

**成果物:**
- [ ] cron 設定完了
- [ ] 日次同期自動実行
- [ ] dbt 変換自動実行
- [ ] レポート生成自動実行

---

### Phase 8: GitHub Actions 整理

**目的:** GitHub Actions を CI/CD 専用に整理

| # | タスク | 状態 |
|---|--------|------|
| 8.1 | 同期ワークフロー削除（または無効化） | ⬜ |
| 8.2 | CI ワークフロー整理（test, lint, typecheck） | ⬜ |
| 8.3 | デプロイワークフロー作成（将来用） | ⬜ |

**成果物:**
- [ ] GitHub Actions は CI/CD 専用
- [ ] 同期は OCI VM で実行

---

### Phase 9: 統合テスト・ドキュメント整備（Phase B 完了）

**目的:** 並行運用の動作確認とドキュメント完成

#### 9.1 統合テスト

| # | タスク | 状態 |
|---|--------|------|
| 9.1.1 | 全サービス起動確認: `docker compose up` | ⬜ |
| 9.1.2 | console → server 通信確認 | ⬜ |
| 9.1.3 | 同期実行確認（Toggl, GCal） | ⬜ |
| 9.1.4 | cron 実行確認 | ⬜ |

#### 9.2 ドキュメント

| # | タスク | 状態 |
|---|--------|------|
| 9.2.1 | `infra/README.md` 完成 | ⬜ |
| 9.2.2 | ADR-007 ステータス更新（承認済み） | ⬜ |
| 9.2.3 | 本計画ステータス更新（Phase B 完了） | ⬜ |

**成果物:**
- [ ] Phase B 完了（並行運用可能）
- [ ] ドキュメント完成

---

## 将来タスク（Phase C 以降）

Phase B 完了後、以下を順次実施:

### Python サービス Docker 化

| パッケージ | 内容 |
|-----------|------|
| analyzer | FastAPI + ML/LLM |
| adjuster | FastAPI + 調整提案 |

### reporter Docker 化

| 内容 |
|------|
| Node.js + Typst CLI |

### visualizer 移行

| 内容 |
|------|
| ローカル Grafana → Grafana Cloud |

### 完全移行

| 内容 |
|------|
| GitHub Actions 同期ワークフロー完全削除 |
| console からの同期を server API 経由に統一 |

---

## 検証チェックリスト

### Phase 1 完了時
- [ ] OCI コンソールで VM が RUNNING
- [ ] `ssh lifetracer` で接続可能
- [ ] Public IP が固定されている

### Phase 2 完了時
- [ ] `docker --version` が表示される
- [ ] `docker compose version` が表示される
- [ ] VSCode Remote SSH で接続・編集可能

### Phase 5 完了時
- [ ] `https://api.example.com/health` が応答
- [ ] SSL 証明書が有効（Cloudflare 発行）

### Phase 6 完了時
- [ ] Vercel ダッシュボードでデプロイ成功
- [ ] console から同期ボタンで server API 呼び出し成功

### Phase 9 完了時（Phase B 完了）
- [ ] `docker compose ps` で server が Up
- [ ] console → server → Supabase の同期フロー動作
- [ ] cron で日次同期が動作
- [ ] GitHub Actions は CI/CD のみ実行

---

## 注意事項

### OCI 無料枠の制限

| リソース | 制限 | 本構成での使用 |
|---------|------|---------------|
| ARM VM | 4 OCPU / 24 GB（合計） | 4 OCPU / 24 GB |
| Block Volume | 200 GB | 50 GB（デフォルト） |
| Outbound | 10 TB/月 | 十分 |

**注意:** アイドル状態（CPU/メモリ/ネットワーク < 20%）が7日間続くと回収される可能性あり。日次レポート生成の cron 実行により自然に回避される。

### ARM アーキテクチャ

VM は ARM（aarch64）。Dockerfile で明示:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
```

### 機密情報

Git に含めない:

```gitignore
infra/cloudflare/config.yml
infra/cloudflare/credentials.json
infra/.env
infra/**/*.pem
```

---

## 関連ドキュメント

- [ADR-007 インフラストラクチャ配置](/100-development/130-design/131-decisions/adr_007-infrastructure-layout)
- [ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure)
- [モノレポ移行計画](/300-management/310-planning/migration-plan)
