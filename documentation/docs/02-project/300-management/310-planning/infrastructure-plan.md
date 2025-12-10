---
title: インフラ構築・ホスティング計画
description: ADR-007 で定義したインフラ構成の構築計画（Terraform + シンプル構成版）
---

# インフラ構築・ホスティング計画

## 概要

[ADR-007 インフラストラクチャ配置](/01-product/100-development/130-design/131-decisions/adr_007-infrastructure-layout) で定義した構成を構築するための計画。

GitHub Actions での同期実行から OCI VM 上の常駐サーバーへ移行し、GitHub Actions を本来の CI/CD 用途に戻す。

## アーキテクチャ

### 構成方針

- **IaC (Infrastructure as Code)**: Terraform で OCI リソースを管理
- **コンテナは1つのみ**: server（マルチランタイム）
- **マルチランタイム**: 1つのコンテナに Node + Python + dbt + Typst
- **子プロセス spawn**: バッチ処理は常駐せず、API リクエスト時に spawn
- **非同期レスポンス**: 即座に 202 返却、バックグラウンドで実行
- **セキュリティ**: HTTP + IP 制限（[ADR-008](/01-product/100-development/130-design/131-decisions/adr_008-server-communication-security) 参照）

### システム構成図

```
┌─────────────────────────────────────────────────────────────────┐
│ ローカル PC                                                      │
│                                                                 │
│  infra/terraform/           ~/.oci/config                       │
│  ├── main.tf         ───→   (API キー)                          │
│  ├── variables.tf           │                                   │
│  └── outputs.tf             ▼                                   │
│         │              OCI API                                  │
│         │                                                       │
│         ▼ terraform apply                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ OCI (Terraform で自動構築)                                       │
│                                                                 │
│  VCN: lifetracer-vcn                                            │
│  ├── Subnet: public-subnet                                      │
│  ├── Internet Gateway                                           │
│  └── Security List                                              │
│       ├── SSH: 22 (自分の IP のみ)                               │
│       └── API: 3000 (Vercel IP のみ)                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ VM: lifetracer-vm (ARM, 4 OCPU / 24 GB)                    │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │ server コンテナ (Node + Python + dbt + Typst)         │ │ │
│  │  │                                                       │ │ │
│  │  │  Hono API ─┬─ spawn → connector (Node)               │ │ │
│  │  │            ├─ spawn → transform (dbt)                │ │ │
│  │  │            ├─ spawn → analyzer (Python)              │ │ │
│  │  │            ├─ spawn → adjuster (Python)              │ │ │
│  │  │            └─ spawn → reporter (Node+Typst)          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ HTTP (IP 制限)               │ SSL/TLS
         │                              │
┌─────────────────┐              ┌─────────────────┐
│ Vercel          │              │ Supabase        │
│ (console)       │              │ (PostgreSQL)    │
└─────────────────┘              └─────────────────┘
```

### パッケージ一覧

| パッケージ | ランタイム | 実行方式 | 役割 |
|-----------|-----------|---------|------|
| server | Node (Hono) | 常駐 | API Gateway、spawn 管理 |
| connector | Node | spawn | 外部 API → raw |
| transform | Python (dbt) | spawn | raw → staging → core |
| analyzer | Python | spawn | 推定値計算、ML |
| adjuster | Python | spawn | 目標値調整提案 |
| reporter | Node + Typst | spawn | PDF レポート生成 |
| console | Next.js | Vercel | 管理 UI |

### リクエストフロー

```
console (Vercel)
    │
    ▼ POST /api/sync/toggl
server (Hono)
    │
    ├─ spawn connector → 非同期実行
    │
    └─ return { jobId, status: 'queued' } (202)
              │
              ▼
         connector 実行完了 → Supabase raw 更新
              │
              ▼
         staging/core は view なので自動反映
```

---

## 移行フェーズ

| Phase | 内容 | 状態 |
|-------|------|:----:|
| 0 | OCI API キー準備 | ⬜ |
| 1 | Terraform セットアップ | ⬜ |
| 2 | OCI リソース構築 | ⬜ |
| 3 | VM 環境構築 | ⬜ |
| 4 | infra ディレクトリ作成 | ⬜ |
| 5 | server パッケージ作成 | ⬜ |
| 6 | console デプロイ (Vercel) | ⬜ |
| 7 | cron 設定 | ⬜ |
| 8 | GitHub Actions 整理 | ⬜ |
| 9 | 統合テスト・ドキュメント整備 | ⬜ |

---

## Phase 0: OCI API キー準備

**目的:** Terraform が OCI にアクセスするための認証設定

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 0.1 | OCI Web Console にログイン | ⬜ |
| 0.2 | Identity → Users → 自分 → API Keys → Add API Key | ⬜ |
| 0.3 | 秘密鍵ダウンロード（`oci_api_key.pem`） | ⬜ |
| 0.4 | `~/.oci/` ディレクトリ作成 | ⬜ |
| 0.5 | `~/.oci/config` 作成（OCI が生成するスニペットをコピー） | ⬜ |

### ~/.oci/config 例

```ini
[DEFAULT]
user=ocid1.user.oc1..xxxxx
fingerprint=xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx
tenancy=ocid1.tenancy.oc1..xxxxx
region=ap-tokyo-1
key_file=~/.oci/oci_api_key.pem
```

### 成果物

- `~/.oci/config` 設定完了
- `~/.oci/oci_api_key.pem` 配置完了

---

## Phase 1: Terraform セットアップ

**目的:** Terraform をインストールし、プロジェクト構造を作成

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 1.1 | Terraform インストール（Windows: winget / Chocolatey） | ⬜ |
| 1.2 | `infra/terraform/` ディレクトリ作成 | ⬜ |
| 1.3 | `main.tf`, `variables.tf`, `outputs.tf` 作成 | ⬜ |
| 1.4 | `terraform init` 実行 | ⬜ |

### ディレクトリ構造

```
infra/
├── terraform/
│   ├── main.tf           # OCI リソース定義
│   ├── variables.tf      # 変数定義
│   ├── outputs.tf        # 出力定義（VM IP など）
│   ├── terraform.tfvars  # 変数値（gitignore）
│   └── .terraform/       # プロバイダ（gitignore）
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env.example
├── crontab
└── README.md
```

### main.tf（概要）

```hcl
terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
}

provider "oci" {
  config_file_profile = "DEFAULT"
}

# VCN
resource "oci_core_vcn" "lifetracer_vcn" {
  compartment_id = var.compartment_id
  display_name   = "lifetracer-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
}

# Internet Gateway
resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.lifetracer_vcn.id
  display_name   = "lifetracer-igw"
}

# Route Table
resource "oci_core_route_table" "public_rt" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.lifetracer_vcn.id
  display_name   = "public-route-table"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.igw.id
  }
}

# Security List
resource "oci_core_security_list" "server_sl" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.lifetracer_vcn.id
  display_name   = "server-security-list"

  # Egress: すべて許可
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  # SSH (自分の IP のみ)
  ingress_security_rules {
    protocol = "6"  # TCP
    source   = var.my_ip
    tcp_options {
      min = 22
      max = 22
    }
  }

  # API (Vercel IP のみ)
  ingress_security_rules {
    protocol = "6"
    source   = "76.76.21.0/24"
    tcp_options {
      min = 3000
      max = 3000
    }
  }
}

# Subnet
resource "oci_core_subnet" "public_subnet" {
  compartment_id    = var.compartment_id
  vcn_id            = oci_core_vcn.lifetracer_vcn.id
  cidr_block        = "10.0.1.0/24"
  display_name      = "public-subnet"
  route_table_id    = oci_core_route_table.public_rt.id
  security_list_ids = [oci_core_security_list.server_sl.id]
}

# VM Instance
resource "oci_core_instance" "lifetracer_vm" {
  compartment_id      = var.compartment_id
  availability_domain = var.availability_domain
  display_name        = "lifetracer-vm"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  source_details {
    source_type = "image"
    source_id   = var.image_id  # Oracle Linux 8 ARM
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public_subnet.id
    assign_public_ip = true
  }

  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
  }
}
```

### 成果物

- `terraform init` 成功
- プロバイダダウンロード完了

---

## Phase 2: OCI リソース構築

**目的:** Terraform で VCN / VM を自動構築

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 2.1 | `terraform.tfvars` に変数値設定 | ⬜ |
| 2.2 | `terraform plan` で構成確認 | ⬜ |
| 2.3 | `terraform apply` でリソース作成 | ⬜ |
| 2.4 | SSH config 設定 | ⬜ |
| 2.5 | `ssh lifetracer` で接続確認 | ⬜ |

### terraform.tfvars（例）

```hcl
compartment_id      = "ocid1.compartment.oc1..xxxxx"
availability_domain = "xxxx:AP-TOKYO-1-AD-1"
image_id            = "ocid1.image.oc1.ap-tokyo-1.xxxxx"
ssh_public_key_path = "~/.ssh/lifetracer.pub"
my_ip               = "xxx.xxx.xxx.xxx/32"
```

### outputs.tf

```hcl
output "vm_public_ip" {
  value = oci_core_instance.lifetracer_vm.public_ip
}

output "vm_private_ip" {
  value = oci_core_instance.lifetracer_vm.private_ip
}
```

### SSH config（~/.ssh/config）

```
Host lifetracer
  HostName <terraform output vm_public_ip>
  User opc
  IdentityFile ~/.ssh/lifetracer
```

### 成果物

- OCI VM が RUNNING
- `ssh lifetracer` で接続可能
- Security List で IP 制限設定済み

---

## Phase 3: VM 環境構築

**目的:** Docker と開発ツールをインストール

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 3.1 | システム更新、基本ツールインストール | ⬜ |
| 3.2 | Docker + Docker Compose インストール | ⬜ |
| 3.3 | VSCode Remote SSH 接続確認 | ⬜ |

### セットアップスクリプト

```bash
# SSH 接続後
sudo dnf update -y
sudo dnf install -y git curl

# Docker インストール
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker opc

# 再ログイン後
docker compose version
```

### 成果物

- `docker compose version` 動作
- VSCode Remote SSH 接続可能

---

## Phase 4: infra ディレクトリ作成

**目的:** Docker Compose 構成の作成

### ディレクトリ構造

```
infra/
├── terraform/        # Phase 1 で作成済み
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env.example
├── crontab
└── README.md
```

### docker-compose.yml

```yaml
services:
  server:
    build: .
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ../../packages:/app/packages:ro
      - ./logs:/app/logs
    env_file:
      - .env
```

### Dockerfile（マルチランタイム）

```dockerfile
FROM node:20-slim

# システム依存
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

# dbt インストール
RUN python3 -m pip install --break-system-packages dbt-postgres

# Typst インストール
RUN curl -fsSL https://typst.community/typst-install/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
```

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 4.1 | `infra/docker/` ディレクトリ作成 | ⬜ |
| 4.2 | `docker-compose.yml` 作成 | ⬜ |
| 4.3 | `Dockerfile` 作成（マルチランタイム） | ⬜ |
| 4.4 | `.env.example` 作成 | ⬜ |

### 成果物

- `infra/docker/` ディレクトリ一式
- ビルド可能な Dockerfile

---

## Phase 5: server パッケージ作成

**目的:** Hono API Gateway の実装

### API 設計

```typescript
// packages/server/src/index.ts
import { Hono } from 'hono'
import { spawn } from 'child_process'

const app = new Hono()

// ヘルスチェック
app.get('/health', (c) => c.json({ status: 'ok' }))

// ジョブステータス
app.get('/api/jobs/:id', async (c) => {
  const job = await getJob(c.req.param('id'))
  return c.json(job)
})

// 同期（非同期）
app.post('/api/sync/:service', async (c) => {
  const service = c.req.param('service')
  const jobId = crypto.randomUUID()

  // バックグラウンドで実行
  spawnJob(jobId, 'connector', ['npm', 'run', `sync:${service}`])

  return c.json({ jobId, status: 'queued' }, 202)
})

// dbt 実行（非同期）
app.post('/api/transform', async (c) => {
  const jobId = crypto.randomUUID()
  spawnJob(jobId, 'transform', ['dbt', 'run'])
  return c.json({ jobId, status: 'queued' }, 202)
})

// 分析（非同期）
app.post('/api/analyze', async (c) => {
  const jobId = crypto.randomUUID()
  spawnJob(jobId, 'analyzer', ['python', 'main.py'])
  return c.json({ jobId, status: 'queued' }, 202)
})

// 調整提案（非同期）
app.post('/api/adjust', async (c) => {
  const jobId = crypto.randomUUID()
  spawnJob(jobId, 'adjuster', ['python', 'main.py'])
  return c.json({ jobId, status: 'queued' }, 202)
})

// レポート生成（非同期）
app.post('/api/report', async (c) => {
  const jobId = crypto.randomUUID()
  spawnJob(jobId, 'reporter', ['npm', 'run', 'generate'])
  return c.json({ jobId, status: 'queued' }, 202)
})

export default app
```

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 5.1 | `packages/server/` 作成 | ⬜ |
| 5.2 | Hono + spawn 実装 | ⬜ |
| 5.3 | ジョブ管理（メモリ or SQLite） | ⬜ |
| 5.4 | ローカルテスト | ⬜ |

### 成果物

- `packages/server/` 完成
- `GET /health` 応答

### 備考: セキュリティ設定

IP 制限は Phase 2 の Terraform で Security List として設定済み。
設計の詳細は [ADR-008 サーバー間通信セキュリティ](/01-product/100-development/130-design/131-decisions/adr_008-server-communication-security) を参照。

---

## Phase 6: console デプロイ (Vercel)

**目的:** 管理 UI を Vercel にデプロイ

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 6.1 | Vercel プロジェクト作成 | ⬜ |
| 6.2 | 環境変数設定 | ⬜ |
| 6.3 | API Route 実装（server 呼び出し） | ⬜ |
| 6.4 | デプロイ確認 | ⬜ |

### 環境変数

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
OCI_VM_IP=<OCI VM の Public IP>
```

### 成果物

- console が Vercel で稼働
- 同期ボタンで server API 呼び出し動作

---

## Phase 7: cron 設定

**目的:** 日次バッチの自動実行

### crontab

```bash
# 日次同期パイプライン (JST 01:00 = UTC 16:00)

# 1. データ同期
0 16 * * * curl -X POST http://localhost:3000/api/sync/toggl
5 16 * * * curl -X POST http://localhost:3000/api/sync/gcal

# 2. レポート生成 (必要に応じて)
0 17 * * * curl -X POST http://localhost:3000/api/report
```

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 7.1 | `infra/crontab` 作成 | ⬜ |
| 7.2 | VM に crontab 設定 | ⬜ |
| 7.3 | ログ出力設定 | ⬜ |

### 成果物

- 日次同期自動実行

---

## Phase 8: GitHub Actions 整理

**目的:** GitHub Actions を CI/CD 専用に整理

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 8.1 | 同期ワークフロー削除 or 無効化 | ⬜ |
| 8.2 | CI ワークフロー整理（test, lint） | ⬜ |
| 8.3 | dbt deploy ワークフロー確認 | ⬜ |

### 成果物

- GitHub Actions は CI/CD 専用
- 同期は OCI VM で実行

---

## Phase 9: 統合テスト・ドキュメント整備

**目的:** 全体動作確認とドキュメント完成

### タスク

| # | タスク | 状態 |
|---|--------|:----:|
| 9.1 | `docker compose up` で全サービス起動確認 | ⬜ |
| 9.2 | console → server → Supabase フロー確認 | ⬜ |
| 9.3 | cron 実行確認 | ⬜ |
| 9.4 | `infra/README.md` 完成 | ⬜ |
| 9.5 | ADR-007 ステータス更新 | ⬜ |

### 成果物

- Phase B 完了（並行運用可能）
- ドキュメント完成

---

## 検証チェックリスト

### Phase 2 完了時
- [ ] `terraform apply` 成功
- [ ] OCI コンソールで VM が RUNNING
- [ ] `ssh lifetracer` で接続可能
- [ ] Security List で IP 制限設定済み

### Phase 5 完了時
- [ ] `packages/server/` 完成
- [ ] `GET /health` 応答

### Phase 9 完了時
- [ ] `docker compose ps` で server が Up
- [ ] Vercel からのみ `http://<OCI_IP>:3000/health` が応答
- [ ] 自分の IP からはタイムアウト
- [ ] console から同期ボタンで非同期ジョブ開始
- [ ] ジョブステータス取得可能
- [ ] cron で日次同期が動作

---

## 注意事項

### OCI 無料枠

| リソース | 制限 | 本構成での使用 |
|---------|------|---------------|
| ARM VM | 4 OCPU / 24 GB | 4 OCPU / 24 GB |
| Block Volume | 200 GB | 50 GB |
| Outbound | 10 TB/月 | 十分 |

**注意:** 7日間アイドル状態が続くと回収の可能性あり。cron 実行で自然に回避。

### ARM アーキテクチャ

Dockerfile で明示:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
```

### 機密情報

Git に含めない:

```gitignore
# infra/.gitignore
terraform/.terraform/
terraform/terraform.tfvars
terraform/*.tfstate
terraform/*.tfstate.*
docker/.env
```

---

## Terraform コマンドリファレンス

```bash
cd infra/terraform

# 初期化（プロバイダダウンロード）
terraform init

# 構成確認（dry-run）
terraform plan

# リソース作成
terraform apply

# リソース削除
terraform destroy

# 出力値確認
terraform output vm_public_ip
```

---

## 関連ドキュメント

- [ADR-007 インフラストラクチャ配置](/01-product/100-development/130-design/131-decisions/adr_007-infrastructure-layout)
- [ADR-008 サーバー間通信セキュリティ](/01-product/100-development/130-design/131-decisions/adr_008-server-communication-security)
- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure)
- [Terraform OCI Provider ドキュメント](https://registry.terraform.io/providers/oracle/oci/latest/docs)
