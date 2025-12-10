---
title: "Phase 3: infra ディレクトリ作成"
description: Infrastructure as Code の基盤整備
---

# Phase 3: infra ディレクトリ作成

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | Infrastructure as Code の基盤整備、docker-compose.yml 作成 |
| 前提条件 | Phase 2 完了（Docker稼働） |
| 成果物 | `infra/` ディレクトリ一式、docker-compose.yml |
| 想定作業 | ローカルでのファイル作成、Gitコミット |

---

## Step 3.1: ディレクトリ構造作成

**目的:** infra ディレクトリの基本構造を作成

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.1.1 | infra ディレクトリ作成 | `mkdir infra` | ⬜ |
| 3.1.2 | oci サブディレクトリ | `mkdir -p infra/oci/scripts` | ⬜ |
| 3.1.3 | cloudflare サブディレクトリ | `mkdir -p infra/cloudflare` | ⬜ |
| 3.1.4 | vercel サブディレクトリ | `mkdir -p infra/vercel` | ⬜ |

### 目標構造

```
infra/
├── README.md                    # インフラ概要・使用方法
├── docker-compose.yml           # メイン構成ファイル
├── .env.example                 # 環境変数テンプレート
├── crontab                      # cron設定
│
├── oci/
│   └── scripts/
│       ├── setup-vm.sh          # VM初期セットアップ
│       └── deploy.sh            # デプロイスクリプト
│
├── cloudflare/
│   ├── README.md                # Tunnel設定手順
│   └── config.yml.example       # Tunnel設定テンプレート
│
└── vercel/
    └── vercel.json              # Vercel設定
```

---

## Step 3.2: docker-compose.yml 作成

**目的:** マルチコンテナ構成を定義

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.2.1 | docker-compose.yml 作成 | メインサービス定義 | ⬜ |
| 3.2.2 | ネットワーク定義 | 内部通信用 bridge ネットワーク | ⬜ |
| 3.2.3 | ボリューム定義 | 永続データ用 | ⬜ |

### docker-compose.yml

```yaml
# infra/docker-compose.yml
services:
  # API Gateway (Hono)
  server:
    build:
      context: ../packages/server
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    env_file:
      - .env
    networks:
      - lifetracer
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  # データ同期 (CLI)
  connector:
    build:
      context: ../packages/connector
      dockerfile: Dockerfile
    env_file:
      - .env
    networks:
      - lifetracer
    profiles:
      - cli  # docker compose run でのみ起動

  # dbt 変換
  transform:
    build:
      context: ../packages/transform
      dockerfile: Dockerfile
    env_file:
      - .env
    networks:
      - lifetracer
    profiles:
      - cli

  # レポート生成
  reporter:
    build:
      context: ../packages/reporter
      dockerfile: Dockerfile
    env_file:
      - .env
    volumes:
      - reporter-output:/app/output
    networks:
      - lifetracer
    profiles:
      - cli

  # Cloudflare Tunnel
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    networks:
      - lifetracer
    restart: unless-stopped
    depends_on:
      - server

networks:
  lifetracer:
    driver: bridge

volumes:
  reporter-output:
```

### サービス説明

| サービス | 役割 | 起動方法 |
|---------|------|----------|
| server | API Gateway (Hono) | `docker compose up -d` |
| connector | データ同期 CLI | `docker compose run --rm connector` |
| transform | dbt 変換 | `docker compose run --rm transform` |
| reporter | レポート生成 | `docker compose run --rm reporter` |
| cloudflared | Tunnel | `docker compose up -d` |

---

## Step 3.3: .env.example 作成

**目的:** 必要な環境変数を文書化

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.3.1 | .env.example 作成 | テンプレート作成 | ⬜ |
| 3.3.2 | .gitignore 更新 | .env を除外 | ⬜ |

### .env.example

```bash
# infra/.env.example

# ===================
# Supabase
# ===================
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ===================
# Toggl Track
# ===================
TOGGL_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ===================
# Google Calendar
# ===================
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REFRESH_TOKEN=xxx

# ===================
# Cloudflare Tunnel
# ===================
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoixxxxxx...

# ===================
# dbt
# ===================
DBT_PROFILES_DIR=/app/profiles
```

---

## Step 3.4: README.md 作成

**目的:** インフラ構成と使用方法を文書化

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.4.1 | README.md 作成 | 使用方法、アーキテクチャ図 | ⬜ |

### README.md

```markdown
# infra

OCI VM 上で稼働するインフラ構成

## アーキテクチャ

```
Internet
    │
    ▼
Cloudflare Tunnel
    │
    ▼
┌─────────────────────────────────────┐
│  OCI VM (lifetracer-vm)              │
│  ┌─────────────────────────────────┐ │
│  │  Docker Compose                 │ │
│  │  ┌───────────┐  ┌────────────┐  │ │
│  │  │  server   │  │ cloudflared│  │ │
│  │  │  (Hono)   │  │            │  │ │
│  │  └───────────┘  └────────────┘  │ │
│  │                                 │ │
│  │  CLI (profiles: cli)            │ │
│  │  ┌───────────┐  ┌───────────┐   │ │
│  │  │ connector │  │ transform │   │ │
│  │  └───────────┘  └───────────┘   │ │
│  │  ┌───────────┐                  │ │
│  │  │ reporter  │                  │ │
│  │  └───────────┘                  │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## 使用方法

### 初回セットアップ

```bash
# リポジトリクローン
cd /opt/supabase-sync-jobs
git clone git@github.com:xxx/supabase-sync-jobs.git .

# 環境変数設定
cp infra/.env.example infra/.env
vim infra/.env  # 各値を設定

# サービス起動
cd infra
docker compose up -d
```

### 日常操作

```bash
# サービス状態確認
docker compose ps

# ログ確認
docker compose logs -f server

# 手動同期
docker compose run --rm connector npm run sync:toggl
docker compose run --rm connector npm run sync:gcal

# dbt実行
docker compose run --rm transform dbt run

# レポート生成
docker compose run --rm reporter npm run generate
```

### 更新

```bash
# 最新コード取得
git pull

# イメージ再ビルド
docker compose build

# サービス再起動
docker compose up -d
```

## ディレクトリ構造

```
infra/
├── docker-compose.yml     # メイン構成
├── .env                   # 環境変数（git管理外）
├── .env.example           # テンプレート
├── crontab                # cron設定
├── oci/scripts/           # VMセットアップスクリプト
├── cloudflare/            # Tunnel設定
└── vercel/                # Vercel設定
```
```

---

## Step 3.5: セットアップスクリプト作成

**目的:** VM初期化を自動化

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.5.1 | setup-vm.sh 作成 | VM初期セットアップ | ⬜ |
| 3.5.2 | deploy.sh 作成 | デプロイスクリプト | ⬜ |

### setup-vm.sh

```bash
#!/bin/bash
# infra/oci/scripts/setup-vm.sh
# VM初期セットアップスクリプト

set -e

echo "=== System Update ==="
sudo apt update && sudo apt upgrade -y

echo "=== Install Basic Tools ==="
sudo apt install -y git curl wget vim htop jq build-essential

echo "=== Verify Timezone (UTC) ==="
# VM should stay UTC for cron consistency
timedatectl
echo "Note: VM uses UTC. For JST: TZ=Asia/Tokyo date"

echo "=== Install Docker ==="
# Docker公式インストール
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

echo "=== Create Directories ==="
sudo mkdir -p /opt/supabase-sync-jobs
sudo chown -R $USER:$USER /opt/supabase-sync-jobs

sudo mkdir -p /var/log/supabase-sync-jobs
sudo chown -R $USER:$USER /var/log/supabase-sync-jobs

echo "=== Setup Complete ==="
echo "Please logout and login again to use docker without sudo"
```

### deploy.sh

```bash
#!/bin/bash
# infra/oci/scripts/deploy.sh
# デプロイスクリプト

set -e

DEPLOY_DIR="/opt/supabase-sync-jobs"

echo "=== Pulling Latest Code ==="
cd $DEPLOY_DIR
git pull origin main

echo "=== Building Images ==="
cd $DEPLOY_DIR/infra
docker compose build

echo "=== Restarting Services ==="
docker compose up -d

echo "=== Checking Status ==="
docker compose ps

echo "=== Deploy Complete ==="
```

---

## Step 3.6: Cloudflare 設定テンプレート

**目的:** Tunnel設定のテンプレートを準備

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.6.1 | config.yml.example 作成 | Tunnel設定テンプレート | ⬜ |
| 3.6.2 | cloudflare/README.md 作成 | 設定手順 | ⬜ |

### config.yml.example

```yaml
# infra/cloudflare/config.yml.example
# このファイルは参考用。実際は TUNNEL_TOKEN 環境変数でTunnelを起動

tunnel: <TUNNEL_UUID>
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: api.lifetracer.example.com
    service: http://server:3000
  - service: http_status:404
```

### cloudflare/README.md

```markdown
# Cloudflare Tunnel 設定

## 概要

Cloudflare Tunnel を使用して、OCI VM 上の server を HTTPS で公開する。

## セットアップ手順

### 1. Cloudflare Dashboard でトンネル作成

1. Cloudflare Dashboard > Zero Trust > Networks > Tunnels
2. Create a tunnel
3. 名前: `lifetracer-tunnel`
4. トークンをコピー

### 2. 環境変数設定

```bash
# infra/.env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoixxxxxx...
```

### 3. DNS設定

Tunnels > lifetracer-tunnel > Public Hostname

- Subdomain: `api`
- Domain: `lifetracer.example.com`
- Service: `http://server:3000`

### 4. 起動

```bash
docker compose up -d cloudflared
```

## 確認

```bash
curl https://api.lifetracer.example.com/health
```
```

---

## Step 3.7: .gitignore 更新

**目的:** 機密ファイルをGit管理から除外

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.7.1 | .gitignore 追加 | infra関連の除外設定 | ⬜ |

### 追加する内容

```gitignore
# infra secrets
infra/.env
infra/cloudflare/config.yml
infra/cloudflare/credentials.json
infra/**/*.pem
```

---

## Step 3.8: Nx project.json 作成

**目的:** infra を Nx プロジェクトとして登録

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 3.8.1 | project.json 作成 | Nx設定 | ⬜ |

### project.json

```json
{
  "name": "infra",
  "projectType": "application",
  "sourceRoot": "infra",
  "targets": {
    "up": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "infra",
        "command": "docker compose up -d"
      }
    },
    "down": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "infra",
        "command": "docker compose down"
      }
    },
    "logs": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "infra",
        "command": "docker compose logs -f"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "infra",
        "command": "docker compose build"
      }
    }
  },
  "tags": ["scope:infra", "type:app"]
}
```

---

## 完了チェックリスト

- [ ] `infra/` ディレクトリ構造が作成された
- [ ] `infra/docker-compose.yml` が作成された
- [ ] `infra/.env.example` が作成された
- [ ] `infra/README.md` が作成された
- [ ] `infra/oci/scripts/setup-vm.sh` が作成された
- [ ] `infra/oci/scripts/deploy.sh` が作成された
- [ ] `infra/cloudflare/config.yml.example` が作成された
- [ ] `infra/cloudflare/README.md` が作成された
- [ ] `.gitignore` に infra 関連の除外設定が追加された
- [ ] `infra/project.json` が作成された
- [ ] Git コミット完了

---

## 次のステップ

→ [Phase 4: server パッケージ作成](./infra-phase-4-server-package)
