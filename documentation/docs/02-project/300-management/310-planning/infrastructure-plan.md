---
title: インフラ構築・ホスティング計画
description: GitHub Actions ベースのシンプルなインフラ構成
---

# インフラ構築・ホスティング計画

## 概要

GitHub Actions を継続使用し、シンプルな構成を維持する。

常駐サーバー（OCI VM）の構築を検討したが、以下の理由で見送り：

- OCI ARM インスタンス（4 OCPU/24GB 無料枠）は常に Out of Capacity
- x86 Micro（1 OCPU/1GB）ではリソース不足
- 環境構築・管理の運用コストが高い

## アーキテクチャ

### 構成方針

- **実行環境**: GitHub Actions（cron + workflow_dispatch）
- **管理UI**: Vercel（console）
- **データベース**: Supabase（PostgreSQL）
- **可視化**: Grafana Cloud

### システム構成図

```
┌─────────────────────────────────────────────────────────────────┐
│ GitHub Actions                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  sync-toggl.yml (cron: 01:00 JST / workflow_dispatch)   │   │
│  │  - connector: Toggl API → Supabase raw                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  sync-gcal.yml (cron: 01:05 JST / workflow_dispatch)    │   │
│  │  - connector: Google Calendar API → Supabase raw        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  dbt-run.yml (cron: 02:00 JST / workflow_dispatch)      │   │
│  │  - transform: raw → staging → core → marts              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ci.yml (push / pull_request)                           │   │
│  │  - test, lint, typecheck, build                         │   │
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

### パッケージ一覧

| パッケージ | ランタイム | 実行方式 | 役割 |
|-----------|-----------|---------|------|
| connector | Node.js | GitHub Actions | 外部 API → raw |
| transform | Python (dbt) | GitHub Actions | raw → staging → core |
| analyzer | Python | GitHub Actions | 推定値計算、ML |
| adjuster | Python | GitHub Actions | 目標値調整提案 |
| reporter | Node.js + Typst | GitHub Actions | PDF レポート生成 |
| console | Next.js | Vercel | 管理 UI |

### リクエストフロー

```
console (Vercel)
    │
    ▼ GitHub API (workflow_dispatch)
GitHub Actions
    │
    ├─ connector 実行 → Supabase raw 更新
    │
    └─ return (ワークフロー開始)
```

## console からの実行

### GitHub API 経由でワークフロー起動

```typescript
// packages/console/src/app/api/sync/[service]/route.ts
export async function POST(request: Request, { params }: { params: { service: string } }) {
  const { service } = params

  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/sync-${service}.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({
        ref: 'main',
      }),
    }
  )

  if (response.status === 204) {
    return Response.json({ status: 'triggered' })
  }

  return Response.json({ error: 'Failed to trigger workflow' }, { status: 500 })
}
```

### 環境変数（Vercel）

```
GITHUB_TOKEN=ghp_xxx  # workflow dispatch 権限が必要
GITHUB_OWNER=your-username
GITHUB_REPO=dwhbi
```

## 日次バッチスケジュール

| 時刻 (JST) | ワークフロー | 処理内容 |
|------------|-------------|---------|
| 01:00 | sync-toggl.yml | Toggl 同期 |
| 01:05 | sync-gcal.yml | Google Calendar 同期 |
| 02:00 | dbt-run.yml | dbt transform |

## メリット・デメリット

### メリット

- **管理コストゼロ**: インフラ管理不要
- **無料**: GitHub Actions 無料枠（2,000分/月 private）で十分
- **信頼性**: GitHub のインフラに依存
- **シンプル**: 既存のワークフローをそのまま使用

### デメリット

- **コールドスタート**: 毎回コンテナ起動（30秒〜1分）
- **実行時間制限**: 6時間/ジョブ（現状の処理では問題なし）
- **リアルタイム性なし**: 即座のレスポンスは不可

## 将来の拡張

常駐サーバーが必要になった場合の選択肢：

| サービス | 無料枠 | 特徴 |
|---------|--------|------|
| Fly.io | 3 shared VMs | Docker デプロイ、シンプル |
| Railway | $5/月クレジット | 使いやすい |
| Render | 750時間/月 | スリープあり |
| Hetzner | なし（€4.5/月〜） | 安価で高性能 |

## 関連ドキュメント

- [ADR-007 インフラストラクチャ配置](/01-product/100-development/130-design/131-decisions/adr_007-infrastructure-layout)
- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure)
