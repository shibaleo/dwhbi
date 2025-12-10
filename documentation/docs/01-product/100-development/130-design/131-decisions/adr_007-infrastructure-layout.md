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
7. **GitHub Actions の役割**: CI/CD 本来の用途に集中

## 決定

### 決定1: インフラストラクチャを2層に分離

| 層 | フォルダ | 責務 | 変更トリガー |
|----|---------|------|-------------|
| **データ層** | `supabase/` | スキーマ、RLS、型定義 | 機能追加・データモデル変更 |
| **コンピュート層** | `infra/` | 実行環境、ネットワーク | 初期構築、スケール変更 |

### 決定2: Docker Compose による多言語ランタイム管理

長期運用における再現性を確保するため、Docker Compose を採用する。

### 決定3: GitHub Actions は CI/CD 専用

GitHub Actions はリポジトリの品質管理に集中する：

| 用途 | GitHub Actions | OCI VM |
|------|---------------|--------|
| テスト | ✅ | - |
| lint/typecheck | ✅ | - |
| ビルド | ✅ | - |
| 同期実行 | ❌ | ✅ (server API) |
| 日次バッチ | ❌ | ✅ (cron) |

**理由**: 同期スクリプトの実行は本来の CI/CD の用途ではない。OCI VM 上のアプリケーションサーバーに移行することで、GitHub Actions を本来の用途に戻す。

### 決定4: コンポーネント別ランタイム

| パッケージ | ランタイム | フレームワーク | 実行パターン | デプロイ先 |
|-----------|-----------|--------------|-------------|-----------|
| server | Node.js | **Hono** | 常駐 | OCI VM |
| connector | Node.js/TS | ライブラリ | server から呼出 | OCI VM |
| analyzer | Python | FastAPI | 常駐 | OCI VM |
| adjuster | Python | FastAPI | 常駐 | OCI VM |
| transform | Python | dbt | バッチ (cron) | OCI VM |
| reporter | Node.js + Typst | Hono | 常駐 | OCI VM |
| console | Next.js | - | 常駐 | Vercel |
| visualizer | - | - | - | Grafana Cloud |

**connector の位置づけ**: connector は独立したライブラリとして実装され、server が import して API として公開する。CLI としても単独実行可能。

### 決定5: Hono を API フレームワークとして採用

Express ではなく Hono を選択。

| 観点 | Hono | Express |
|------|------|---------|
| TypeScript | ✅ ネイティブ | △ @types必要 |
| バンドルサイズ | ✅ 14KB | △ 200KB+ |
| パフォーマンス | ✅ 高速 | △ 普通 |
| API互換性 | Express互換 | - |

**選択理由**: 新規プロジェクトで Express の既存資産がないため、TypeScriptネイティブでシンプルな Hono を採用。

### 決定6: VSCode Remote SSH による開発環境

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

### 決定7: Cloudflare Tunnel による HTTPS アクセス

Named Tunnel を使用し、永続的な HTTPS エンドポイントを確保する。

- VM のファイアウォールは SSH (22) のみ開放
- SSL 終端は Cloudflare 側
- VM 内部は HTTP 通信

---

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              インターネット                               │
└────┬──────────────┬──────────────┬──────────────┬──────────────┬───────┘
     │              │              │              │              │
     ▼              ▼              ▼              ▼              ▼
┌─────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  ┌────────┐
│ GitHub  │  │  Vercel   │  │Cloudflare │  │ Supabase     │  │Grafana │
│ Actions │  │ (console) │  │ (Tunnel)  │  │ (PostgreSQL) │  │ Cloud  │
│ CI/CD   │  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  └────┬───┘
└────┬────┘        │              │               │               │
     │             │   Serverless │               │               │
     │             │   Function   │               │               │
     ▼             ▼              ▼               │               │
┌─────────────────────────────────────────────────┼───────────────┼──────┐
│  リポジトリ                                      │               │      │
│  ┌──────────────────────────────────────────┐   │               │      │
│  │  packages/                               │   │               │      │
│  │  ├── connector/ (TypeScript)            │   │               │      │
│  │  ├── console/   (Next.js)               │   │               │      │
│  │  └── ...                                 │   │               │      │
│  └──────────────────────────────────────────┘   │               │      │
└─────────────────────────────────────────────────┼───────────────┼──────┘
                                                  │               │
              ┌───────────────────────────────────┼───────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      OCI VM (ARM/4CPU/24GB)                             │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Docker Compose                                │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │                 server (Hono) :3000                         │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐    │  │  │
│  │  │  │  connector (TypeScript ライブラリ)                   │    │  │  │
│  │  │  │  - toggl-track sync                                 │    │  │  │
│  │  │  │  - google-calendar sync                             │    │  │  │
│  │  │  └─────────────────────────────────────────────────────┘    │  │  │
│  │  │                                                             │  │  │
│  │  │  API Endpoints:                                             │  │  │
│  │  │  POST /api/sync/toggl                                       │  │  │
│  │  │  POST /api/sync/gcal                                        │  │  │
│  │  │  POST /api/analyze                                          │  │  │
│  │  │  POST /api/adjust                                           │  │  │
│  │  │  POST /api/report                                           │  │  │
│  │  └──────────────────────────┬──────────────────────────────────┘  │  │
│  │                             │                                     │  │
│  │          ┌──────────────────┼──────────────────┐                  │  │
│  │          ▼                  ▼                  ▼                  │  │
│  │  ┌────────────┐     ┌────────────┐     ┌────────────┐             │  │
│  │  │  analyzer  │     │  adjuster  │     │  reporter  │             │  │
│  │  │  FastAPI   │     │  FastAPI   │     │   Hono     │             │  │
│  │  │  :8001     │     │  :8002     │     │  + Typst   │             │  │
│  │  │  Python    │     │  Python    │     │  :8003     │             │  │
│  │  └────────────┘     └────────────┘     └────────────┘             │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │  transform (dbt)                                            │  │  │
│  │  │  cron: 毎日 01:00 JST                                       │  │  │
│  │  │  - raw → staging → core → marts                             │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                      │                                  │
│                                      │ HTTPS                            │
│                                      ▼                                  │
│                             ┌─────────────┐                             │
│                             │  Supabase   │                             │
│                             │  PostgreSQL │                             │
│                             └─────────────┘                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## リクエストフロー

### 同期実行（オンデマンド）

```
ユーザー
  │
  ▼
console (Vercel)
  │ クリック: "Toggl 同期"
  ▼
Vercel Serverless Function
  │ POST /api/sync/toggl
  ▼
Cloudflare Tunnel (HTTPS)
  │
  ▼
server (Hono) :3000
  │ import { syncToggl } from '@repo/connector'
  ▼
connector
  │ Toggl API → Supabase raw layer
  ▼
Supabase PostgreSQL
```

### 日次バッチ（cron）

```
cron (01:00 JST)
  │
  ├─→ docker compose run connector sync:toggl
  ├─→ docker compose run connector sync:gcal
  │
  └─→ docker compose run transform dbt run
        │
        ▼
      Supabase PostgreSQL
        raw → staging → core → marts
```

---

## リポジトリ配置構成

```
dwhbi/
├── .github/
│   └── workflows/
│       ├── ci.yml              # テスト、lint、typecheck
│       └── deploy.yml          # OCI VM へのデプロイ（将来）
│
├── supabase/                   # データ層（Supabase CLI 規約に従う）
│   ├── config.toml
│   ├── migrations/
│   └── seed.sql
│
├── packages/
│   │  # ===== OCI VM (Docker) =====
│   ├── server/                 # Node.js (Hono) - APIゲートウェイ
│   │   ├── src/
│   │   │   ├── index.ts        # Hono app
│   │   │   └── routes/
│   │   │       ├── sync.ts     # connector を呼び出し
│   │   │       ├── analyze.ts
│   │   │       └── ...
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── connector/              # Node.js/TS - ライブラリ + CLI
│   │   ├── src/
│   │   │   ├── index.ts        # エクスポート
│   │   │   └── services/
│   │   │       ├── toggl-track/
│   │   │       └── google-calendar/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── analyzer/               # Python (FastAPI) - ML/LLM
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   │
│   ├── adjuster/               # Python (FastAPI) - 調整提案
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   │
│   ├── transform/              # Python (dbt) - バッチ
│   │   ├── models/
│   │   ├── Dockerfile
│   │   └── dbt_project.yml
│   │
│   ├── reporter/               # Node.js + Typst - PDF生成
│   │   ├── src/
│   │   ├── templates/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   │  # ===== Vercel =====
│   ├── console/                # Next.js - 管理UI
│   │   ├── src/
│   │   │   └── app/
│   │   │       └── api/        # Serverless Functions
│   │   │           └── sync/
│   │   │               └── [service]/
│   │   │                   └── route.ts  # → server API を呼び出し
│   │   └── ...
│   │
│   │  # ===== Grafana Cloud（設定のみ）=====
│   ├── visualizer/             # ダッシュボードJSON, SQL
│   │   ├── dashboards/
│   │   └── queries/
│   │
│   │  # ===== 共有 =====
│   └── database-types/         # Supabase型定義
│
├── infra/                      # コンピュート/ネットワーク層
│   ├── README.md
│   ├── docker-compose.yml      # OCI VM用
│   ├── crontab                 # 日次バッチスケジュール
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
├── nx.json
├── package.json
├── tsconfig.base.json
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
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - DIRECT_DATABASE_URL=${DIRECT_DATABASE_URL}
    restart: always
    depends_on:
      - analyzer
      - adjuster
      - reporter

  analyzer:
    build: ../packages/analyzer
    expose:
      - "8001"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
    restart: unless-stopped

  adjuster:
    build: ../packages/adjuster
    expose:
      - "8002"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
    restart: unless-stopped

  reporter:
    build: ../packages/reporter
    expose:
      - "8003"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
    restart: unless-stopped

  transform:
    build: ../packages/transform
    profiles: ["batch"]
    environment:
      - DBT_PROFILES_DIR=/app
      - DIRECT_DATABASE_URL=${DIRECT_DATABASE_URL}
    # cron または手動実行: docker compose run transform dbt run

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    volumes:
      - ./cloudflare/config.yml:/etc/cloudflared/config.yml:ro
      - ./cloudflare/credentials.json:/etc/cloudflared/credentials.json:ro
    restart: always
```

---

## cron 設定

```bash
# infra/crontab
# 日次同期 (01:00 JST = 16:00 UTC)
0 16 * * * cd /opt/dwhbi/infra && docker compose run --rm connector npm run sync:toggl >> /var/log/sync.log 2>&1
5 16 * * * cd /opt/dwhbi/infra && docker compose run --rm connector npm run sync:gcal >> /var/log/sync.log 2>&1

# dbt transform (02:00 JST = 17:00 UTC)
0 17 * * * cd /opt/dwhbi/infra && docker compose run --rm transform dbt run >> /var/log/dbt.log 2>&1
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

### GitHub Actions から OCI VM への移行理由

| 観点 | GitHub Actions | OCI VM (server) |
|------|---------------|-----------------|
| 本来の用途 | CI/CD | アプリケーション実行 |
| 実行時間制限 | あり (6時間) | なし |
| コスト | 無料枠あり | 無料枠 (Always Free) |
| 状態管理 | ステートレス | 常駐可能 |
| 認証情報 | Secrets | Vault + .env |

GitHub Actions で同期スクリプトを実行するのは過渡期の実装。本来の CI/CD に集中させる。

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

### 案5: GitHub Actions で同期を継続

**却下理由:**
- CI/CD の本来の用途ではない
- Secrets 管理が煩雑
- 実行時間制限あり
- OCI VM の常駐サーバーのほうが柔軟

---

## 機密情報の管理

| ファイル | Git管理 | 内容 |
|---------|--------|------|
| `*.example` | ✅ | テンプレート |
| `terraform.tfvars` | ❌ | OCI 認証情報 |
| `config.yml` | ❌ | Tunnel ID、credentials |
| `credentials.json` | ❌ | Cloudflare credentials |
| `*.pem` | ❌ | SSH 秘密鍵 |
| `.env` | ❌ | 環境変数 |

`.gitignore` への追加：

```gitignore
# Infrastructure secrets
infra/oci/terraform/*.tfvars
infra/oci/terraform/.terraform/
infra/oci/terraform/*.tfstate*
infra/cloudflare/config.yml
infra/cloudflare/credentials.json
infra/**/*.pem
```

---

## 影響

### 新規作成

- `packages/server/` - Hono API サーバー
- `infra/README.md` - 全体構成図、セットアップ手順
- `infra/docker-compose.yml` - Docker Compose 定義
- `infra/crontab` - 日次バッチスケジュール
- `infra/oci/terraform/*.tf` - OCI リソース定義
- `infra/oci/scripts/` - VM セットアップスクリプト
- `infra/cloudflare/config.yml.example` - Tunnel 設定テンプレート
- `packages/server/Dockerfile` - server コンテナ
- `packages/analyzer/Dockerfile` - analyzer コンテナ
- `packages/adjuster/Dockerfile` - adjuster コンテナ
- `packages/reporter/Dockerfile` - reporter コンテナ
- `packages/transform/Dockerfile` - transform コンテナ

### 変更

- `.github/workflows/` - CI/CD 専用に整理（同期ワークフロー削除）
- `packages/console/` - Vercel Serverless → server API 呼び出し

### 変更なし

- `supabase/` - 現状維持
- `packages/connector/` - ライブラリとして維持（CLI も残す）

---

## 移行計画

### Phase A: 現状（GitHub Actions）

```
console → GitHub Actions dispatch → connector (Python)
```

### Phase B: server 作成（並行運用）

```
console → GitHub Actions dispatch → connector (Python)  ← 既存
console → Vercel Serverless → server → connector (TS)   ← 新規
```

### Phase C: 完全移行

```
console → Vercel Serverless → server → connector (TS)
GitHub Actions: CI/CD 専用
cron: 日次バッチ
```

**現在のステータス**: Phase A と B の間（connector TypeScript 移行完了）

---

## 関連ドキュメント

- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure)
- [121 リポジトリ構成](/01-product/100-development/120-specifications/121-overview/repository-structure)
- [migration-plan](/02-project/300-management/310-planning/migration-plan) - モノレポ移行計画
