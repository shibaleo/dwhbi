---
title: ADR-007 インフラストラクチャ配置
description: GitHub Actions ベースのシンプルなインフラ構成
---

# ADR-007: インフラストラクチャ配置

## ステータス

承認済み（2025-12-10）- GitHub Actions 継続に変更

## コンテキスト

本プロジェクトは複数のインフラストラクチャコンポーネントを使用する：

| 種類 | サービス | 役割 |
|------|---------|------|
| BaaS | Supabase | データベース、認証、型生成 |
| CI/CD | GitHub Actions | 同期実行、dbt 実行、CI |
| SaaS | Grafana Cloud | 可視化ダッシュボード |
| PaaS | Vercel | 管理UI（console）ホスティング |

### 検討した構成

当初、OCI VM 上に常駐サーバーを構築する計画だった：

- OCI Always Free: ARM 4 OCPU / 24GB RAM
- Docker Compose で多言語ランタイム管理
- Hono API サーバーで同期を実行

### 見送った理由

1. **OCI ARM インスタンスの可用性問題**
   - 4 OCPU/24GB の ARM インスタンスは常に "Out of Capacity"
   - 実質的に作成不可能

2. **x86 Micro の制約**
   - 1 OCPU / 1GB RAM では Node + Python + dbt は厳しい
   - メモリ不足で実用的でない

3. **運用コスト**
   - OS、ランタイム、セキュリティパッチの管理が必要
   - SSH 接続問題、ファイアウォール設定など手間がかかる

4. **現状の用途**
   - 日次バッチ（1日1回）では常駐サーバーのメリットが薄い
   - コールドスタート 30秒〜1分は許容範囲

## 決定

### 決定1: GitHub Actions を継続使用

常駐サーバーを構築せず、GitHub Actions で同期・バッチ処理を継続する。

| 用途 | 実行環境 |
|------|---------|
| 日次同期 (Toggl, GCal) | GitHub Actions (cron) |
| dbt transform | GitHub Actions (cron) |
| 手動同期 | GitHub Actions (workflow_dispatch) |
| テスト、lint | GitHub Actions (push/PR) |
| 管理 UI | Vercel |

### 決定2: console から GitHub API で起動

console から同期を実行する場合、GitHub API の workflow_dispatch を使用：

```typescript
// Vercel Serverless Function
await fetch(
  `https://api.github.com/repos/owner/repo/actions/workflows/sync-toggl.yml/dispatches`,
  {
    method: 'POST',
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
    body: JSON.stringify({ ref: 'main' }),
  }
)
```

### 決定3: infra/ ディレクトリは不要

OCI/Docker 関連のインフラ設定は不要となった。

```
dwhbi/
├── .github/workflows/    # CI/CD + 同期 + バッチ
├── supabase/             # データ層
└── packages/             # アプリケーション
    # infra/ は削除
```

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│ GitHub Actions                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  sync-toggl.yml (cron: 01:00 JST / workflow_dispatch)   │   │
│  │  sync-gcal.yml  (cron: 01:05 JST / workflow_dispatch)   │   │
│  │  dbt-run.yml    (cron: 02:00 JST / workflow_dispatch)   │   │
│  │  ci.yml         (push / pull_request)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         │ workflow_dispatch            │ SSL/TLS
         │                              │
┌─────────────────┐              ┌─────────────────┐
│ Vercel          │              │ Supabase        │
│ (console)       │              │ (PostgreSQL)    │
└─────────────────┘              └─────────────────┘
```

## パッケージ配置

| パッケージ | ランタイム | 実行環境 | 役割 |
|-----------|-----------|---------|------|
| connector | Node.js | GitHub Actions | 外部 API → raw |
| transform | Python (dbt) | GitHub Actions | raw → staging → core |
| analyzer | Python | GitHub Actions | 推定値計算、ML |
| adjuster | Python | GitHub Actions | 目標値調整提案 |
| reporter | Node.js + Typst | GitHub Actions | PDF レポート生成 |
| console | Next.js | Vercel | 管理 UI |

## 理由

### GitHub Actions を継続する理由

| 観点 | GitHub Actions | 常駐サーバー |
|------|---------------|-------------|
| 管理コスト | ゼロ | OS/ランタイム管理必要 |
| 無料枠 | 2,000分/月 (private) | OCI ARM は取得困難 |
| 信頼性 | GitHub 任せ | 自分で障害対応 |
| コールドスタート | 30秒〜1分 | なし |
| 実行時間制限 | 6時間/ジョブ | なし |

現状の用途（日次バッチ）では、コールドスタートのデメリットより管理コストゼロのメリットが上回る。

## 却下した代替案

### 案1: OCI VM + Docker Compose

**却下理由:**
- ARM インスタンス (4 OCPU/24GB) は Out of Capacity で作成不可
- x86 Micro (1 OCPU/1GB) ではリソース不足
- 環境構築・管理の運用コストが高い

### 案2: Fly.io / Railway / Render

**却下理由:**
- 現状の用途では過剰
- 日次バッチなら GitHub Actions で十分
- 将来必要になったら検討

### 案3: AWS Lambda / GCP Cloud Functions

**却下理由:**
- GitHub Actions で十分
- 追加のクラウドアカウント管理が増える

## 将来の拡張

常駐サーバーが必要になった場合（リアルタイム API、WebSocket 等）：

| サービス | 無料枠 | 特徴 |
|---------|--------|------|
| Fly.io | 3 shared VMs | Docker デプロイ、シンプル |
| Railway | $5/月クレジット | 使いやすい |
| Render | 750時間/月 | スリープあり |
| Hetzner | なし（€4.5/月〜） | 安価で高性能 |

## 影響

### 削除

- `infra/` ディレクトリ（OCI Terraform、Docker Compose）
- `packages/server/` の計画（Hono API サーバー）

### 変更なし

- `.github/workflows/` - 既存のワークフローを継続
- `supabase/` - 現状維持
- `packages/connector/` - GitHub Actions から実行

### 新規（必要に応じて）

- `packages/console/src/app/api/` - GitHub API 経由の workflow dispatch

## 関連ドキュメント

- [インフラ構築計画](/02-project/300-management/310-planning/infrastructure-plan)
- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure)
