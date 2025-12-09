---
title: ADR-007 インフラストラクチャ配置
description: Supabase（データ層）とその他インフラ（コンピュート/ネットワーク層）の分離配置、およびアプリケーションサーバー構成
---

# ADR-007: インフラストラクチャ配置

## ステータス

提案中（2025-12-09）

## コンテキスト

本プロジェクトは複数のインフラストラクチャコンポーネントを使用する：

| 種類 | サービス | 役割 |
|------|---------|------|
| BaaS | Supabase | データベース、認証、型生成 |
| IaaS | Oracle Cloud | アプリケーションサーバー（VM） |
| SaaS | Cloudflare | Tunnel、DNS、SSL終端 |
| SaaS | Grafana Cloud | 可視化ダッシュボード |
| PaaS | Vercel | 管理UI（console）ホスティング |

ADR-005 でモノレポ構成を採用したが、インフラストラクチャ設定ファイルの配置については未定義だった。以下の観点から配置方針を決定する必要がある：

1. **Supabase CLI の規約**: `supabase/` ディレクトリをルートに期待
2. **Infrastructure as Code**: 設定ファイルのバージョン管理
3. **責務の分離**: データ層とコンピュート層の変更頻度の違い
4. **機密情報の管理**: シークレットの分離
5. **多言語ランタイム**: Node.js と Python の共存
6. **長期運用**: OCI無料枠が尽きるまでの運用を想定

## 決定

### 決定1: インフラストラクチャを2層に分離

| 層 | フォルダ | 責務 | 変更トリガー |
|----|---------|------|-------------|
| **データ層** | `supabase/` | スキーマ、RLS、型定義 | 機能追加・データモデル変更 |
| **コンピュート層** | `infra/` | 実行環境、ネットワーク | 初期構築、スケール変更 |

### 決定2: Docker Compose による多言語ランタイム管理

長期運用における再現性を確保するため、Docker Compose を採用する。

### 決定3: コンポーネント別ランタイム

| パッケージ | ランタイム | フレームワーク | 実行パターン | デプロイ先 |
|-----------|-----------|--------------|-------------|-----------|
| server | Node.js | **Hono** | 常駐 | OCI VM |
| connector | Node.js/TS | (serverにバンドル) | 常駐 | OCI VM |
| analyzer | Python | FastAPI | 常駐 | OCI VM |
| adjuster | Python | FastAPI | 常駐 | OCI VM |
| transform | Python | dbt | バッチ (cron) | OCI VM |
| reporter | Node.js + Typst | Express/Hono | 常駐 | OCI VM |
| console | Next.js | - | 常駐 | Vercel |
| visualizer | - | - | - | Grafana Cloud |

### 決定4: Hono を API フレームワークとして採用

Express ではなく Hono を選択。

| 観点 | Hono | Express |
|------|------|---------|
| TypeScript | ✅ ネイティブ | △ @types必要 |
| バンドルサイズ | ✅ 14KB | △ 200KB+ |
| パフォーマンス | ✅ 高速 | △ 普通 |
| API互換性 | Express互換 | - |

**選択理由**: 新規プロジェクトで Express の既存資産がないため、TypeScriptネイティブでシンプルな Hono を採用。

### 決定5: VSCode Remote SSH による開発環境

ローカルPC に Docker をインストールせず、OCI VM 上で直接開発する。

```
┌─────────────────┐          SSH          ┌─────────────────────┐
│  ローカルPC      │ ──────────────────→  │  OCI VM (24GB RAM)  │
│                 │                       │                     │
│  VSCode         │                       │  Docker Compose     │
│  (UIのみ)       │                       │  全サービス稼働      │
│                 │                       │                     │
│  Docker不要     │                       │  開発・本番同一環境   │
└─────────────────┘                       └─────────────────────┘
```

### 決定6: Cloudflare Tunnel による HTTPS アクセス

Named Tunnel を使用し、永続的な HTTPS エンドポイントを確保する。

- VM のファイアウォールは SSH (22) のみ開放
- SSL 終端は Cloudflare 側
- VM 内部は HTTP 通信

---

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                           インターネット                             │
└───────┬─────────────┬─────────────┬─────────────┬──────────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
 ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────┐
 │  Vercel   │ │Cloudflare │ │ Supabase  │ │Grafana Cloud │
 │ (console) │ │ (Tunnel)  │ │(PostgreSQL)│ │ (visualizer) │
 └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └──────┬───────┘
       │             │             │              │
       │    Tunnel   │             │              │
       │   (暗号化)   │             │              │
       │             ▼             │              │
       │  ┌─────────────────────────────────────┐ │
       │  │         OCI VM (ARM/4CPU/24GB)      │ │
       │  │                                     │ │
       │  │  ┌─────────────────────────────┐   │ │
       │  │  │     Docker Compose          │   │ │
       │  │  │                             │   │ │
       │  │  │  ┌────────────────────┐     │   │ │
       │  │  │  │ server (Hono)      │     │   │ │
       │  │  │  │ + connector        │     │   │ │
       │  │  │  │ :3000              │     │   │ │
       │  │  │  └─────────┬──────────┘     │   │ │
       │  │  │            │                │   │ │
       └──┼──┼────────────┘                │   │ │
          │  │       ┌──────────┬──────────┤   │ │
          │  │       ▼          ▼          ▼   │ │
          │  │  ┌────────┐ ┌────────┐ ┌──────┐ │ │
          │  │  │analyzer│ │adjuster│ │report│ │ │
          │  │  │FastAPI │ │FastAPI │ │ Node │ │ │
          │  │  │ :8001  │ │ :8002  │ │+Typst│ │ │
          │  │  │ Python │ │ Python │ │:8003 │ │ │
          │  │  └────────┘ └────────┘ └──────┘ │ │
          │  │                                 │ │
          │  │  ┌─────────────────────────┐    │ │
          │  │  │ transform (dbt)        │    │ │
          │  │  │ cron: 毎日 01:00 JST   │    │ │
          │  │  └─────────────────────────┘    │ │
          │  │                                 │ │
          │  └─────────────────────────────────┘ │
          │                    │                 │
          │                    │ HTTPS           │
          │                    ▼                 │
          │           ┌─────────────┐            │
          └──────────→│  Supabase   │←───────────┘
                      │  PostgreSQL │
                      └─────────────┘
```

---

## リポジトリ配置構成

```
supabase-sync-jobs/
├── supabase/                  # データ層（Supabase CLI 規約に従う）
│   ├── config.toml
│   ├── migrations/
│   └── seed.sql
│
├── packages/
│   │  # ===== OCI VM (Docker) =====
│   ├── server/                # Node.js (Hono) - APIゲートウェイ
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── connector/             # Node.js/TS - serverにバンドル
│   │   └── src/
│   │
│   ├── analyzer/              # Python (FastAPI) - ML/LLM
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   │
│   ├── adjuster/              # Python (FastAPI) - ML/LLM
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   │
│   ├── transform/             # Python (dbt) - バッチ
│   │   ├── models/
│   │   ├── Dockerfile
│   │   └── dbt_project.yml
│   │
│   ├── reporter/              # Node.js + Typst - PDF生成
│   │   ├── src/
│   │   ├── templates/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   │  # ===== Vercel =====
│   ├── console/               # Next.js - 管理UI
│   │   └── ...
│   │
│   │  # ===== Grafana Cloud（設定のみ）=====
│   ├── visualizer/            # ダッシュボードJSON, SQL
│   │   ├── dashboards/
│   │   └── queries/
│   │
│   │  # ===== 共有 =====
│   └── database-types/        # Supabase型定義
│
├── infra/                     # コンピュート/ネットワーク層
│   ├── README.md
│   ├── docker-compose.yml     # OCI VM用
│   │
│   ├── oci/
│   │   ├── terraform/
│   │   └── scripts/
│   │       ├── setup-vm.sh
│   │       └── deploy.sh
│   │
│   ├── cloudflare/
│   │   ├── config.yml.example
│   │   └── README.md
│   │
│   └── vercel/
│       └── vercel.json
│
└── ...
```

---

## Docker Compose 構成

```yaml
# infra/docker-compose.yml
services:
  server:
    build: ../packages/server
    ports:
      - "3000:3000"
    environment:
      - ANALYZER_URL=http://analyzer:8001
      - ADJUSTER_URL=http://adjuster:8002
      - REPORTER_URL=http://reporter:8003
    restart: always
    depends_on:
      - analyzer
      - adjuster
      - reporter

  analyzer:
    build: ../packages/analyzer
    expose:
      - "8001"
    restart: unless-stopped

  adjuster:
    build: ../packages/adjuster
    expose:
      - "8002"
    restart: unless-stopped

  reporter:
    build: ../packages/reporter
    expose:
      - "8003"
    restart: unless-stopped

  transform:
    build: ../packages/transform
    profiles: ["batch"]
    # cron または手動実行: docker compose run transform
```

---

## 理由

### Docker を採用した理由

| 観点 | Docker | 直接インストール |
|------|--------|-----------------|
| 再現性 | ◎ Dockerfile で完全再現 | △ スクリプト依存 |
| 長期運用 | ◎ イメージで固定可能 | △ OS更新で壊れる可能性 |
| 依存分離 | ◎ コンテナ単位で隔離 | △ venv等で対応 |
| メモリ | +300MB程度 | ベースのみ |

**24GB RAM** に対して Docker のオーバーヘッドは約1%。再現性のメリットが上回る。

### Supabase を `infra/` に含めない理由

| 観点 | Supabase | OCI/Cloudflare/Vercel |
|------|----------|----------------------|
| 変更頻度 | 高（機能開発と連動） | 低（初期構築後は安定） |
| CLI 規約 | ルート `supabase/` を期待 | 任意 |
| 依存関係 | アプリコードが直接依存 | ランタイム環境のみ |

### Hono を選択した理由

- **TypeScript ネイティブ**: 追加設定なしで型安全
- **Express 互換 API**: 既存の Express 情報が参考になる
- **軽量**: 14KB、起動が速い
- **新規プロジェクト**: Express の既存資産がない

### VSCode Remote SSH を選択した理由

- **ローカル PC が軽い**: Docker インストール不要
- **環境差異なし**: 開発・本番が同一環境
- **デバッグ容易**: VM 上で直接確認可能

---

## 却下した代替案

### 案1: ローカル Docker + VM デプロイ

```
ローカル: docker compose up (開発)
VM: docker compose up (本番)
```

**却下理由:**
- ローカル PC に Docker が必要（重い）
- ARM (VM) と x64 (ローカル) の差異
- 環境差異によるバグリスク

### 案2: Docker なし（直接インストール）

**却下理由:**
- 再現性が低い
- 長期運用で OS 更新時に壊れるリスク
- セットアップ手順が属人化

### 案3: Express 採用

**却下理由:**
- TypeScript 設定が追加で必要
- 新規プロジェクトで古い書き方を学ぶメリットなし
- Hono は Express 互換なので移行も容易

### 案4: analyzer/adjuster を Node.js に移行

**却下理由:**
- ML/LLM エコシステムは Python が圧倒的
- LightGBM, scikit-learn, LangChain 等は Python 前提

---

## 機密情報の管理

| ファイル | Git管理 | 内容 |
|---------|--------|------|
| `*.example` | ✅ | テンプレート |
| `terraform.tfvars` | ❌ | OCI 認証情報 |
| `config.yml` | ❌ | Tunnel ID、credentials |
| `*.pem` | ❌ | SSH 秘密鍵 |
| `.env` | ❌ | 環境変数 |

`.gitignore` への追加：

```gitignore
# Infrastructure secrets
infra/oci/terraform/*.tfvars
infra/oci/terraform/.terraform/
infra/oci/terraform/*.tfstate*
infra/cloudflare/config.yml
infra/**/*.pem
infra/**/*.json
```

---

## 影響

### 新規作成

- `infra/README.md` - 全体構成図、セットアップ手順
- `infra/docker-compose.yml` - Docker Compose 定義
- `infra/oci/terraform/*.tf` - OCI リソース定義
- `infra/oci/scripts/` - VM セットアップスクリプト
- `infra/cloudflare/config.yml.example` - Tunnel 設定テンプレート
- `packages/server/Dockerfile` - server コンテナ
- `packages/analyzer/Dockerfile` - analyzer コンテナ
- `packages/adjuster/Dockerfile` - adjuster コンテナ
- `packages/reporter/Dockerfile` - reporter コンテナ
- `packages/transform/Dockerfile` - transform コンテナ

### 変更なし

- `supabase/` - 現状維持

---

## 関連ドキュメント

- [ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure)
- [121 リポジトリ構成](/100-development/120-specifications/121-overview/repository-structure)
