---
title: "Phase 6: console デプロイ (Vercel)"
description: 管理UIをVercelにデプロイ
---

# Phase 6: console デプロイ (Vercel)

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | 管理 UI (console) を Vercel にデプロイ |
| 前提条件 | Phase 5 完了（server が HTTPS でアクセス可能） |
| 成果物 | Vercel 上で稼働する console、server API 呼び出し機能 |
| 想定作業 | Vercel 設定、Serverless Function 実装 |

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              ▼                       ▼                       │
│     ┌─────────────────┐     ┌─────────────────┐             │
│     │   Vercel        │     │   Supabase      │             │
│     │   (console)     │     │   (PostgreSQL)  │             │
│     │                 │     │                 │             │
│     │ ┌─────────────┐ │     │                 │             │
│     │ │ Next.js App │─┼─────┼─► Direct Query  │             │
│     │ └─────────────┘ │     │   (Supabase JS) │             │
│     │        │        │     │                 │             │
│     │ ┌──────▼──────┐ │     └─────────────────┘             │
│     │ │ Serverless  │ │                                      │
│     │ │ Functions   │ │                                      │
│     │ │ /api/sync/* │ │                                      │
│     │ └──────┬──────┘ │                                      │
│     └────────┼────────┘                                      │
│              │                                               │
│              ▼                                               │
│     ┌─────────────────┐                                      │
│     │ Cloudflare      │                                      │
│     │ Tunnel          │                                      │
│     └────────┬────────┘                                      │
│              │                                               │
│              ▼                                               │
│     ┌─────────────────┐                                      │
│     │ OCI VM          │                                      │
│     │ server (Hono)   │                                      │
│     └─────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

**フロー:**
1. ブラウザ → Vercel (console): ダッシュボード表示
2. console → Supabase: データ取得（直接）
3. console → Vercel Serverless → server: 同期実行

---

## Step 6.1: Vercel アカウント準備

**目的:** Vercel にプロジェクトを作成する準備

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.1.1 | Vercel アカウント確認 | https://vercel.com/ にログイン | ⬜ |
| 6.1.2 | GitHub 連携確認 | Settings → Git Integration | ⬜ |
| 6.1.3 | チーム/個人選択 | Hobby（無料）または Pro | ⬜ |

### 確認事項

- [ ] Vercel アカウントが存在する
- [ ] GitHub アカウントと連携済み
- [ ] リポジトリへのアクセス権限あり

---

## Step 6.2: Vercel プロジェクト作成

**目的:** console パッケージを Vercel にデプロイ

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.2.1 | New Project | Vercel Dashboard → Add New → Project | ⬜ |
| 6.2.2 | リポジトリ選択 | supabase-sync-jobs を選択 | ⬜ |
| 6.2.3 | Root Directory 設定 | `packages/console` | ⬜ |
| 6.2.4 | Framework Preset | Next.js (自動検出) | ⬜ |
| 6.2.5 | Build Settings 確認 | 下記参照 | ⬜ |
| 6.2.6 | Deploy | デプロイ実行 | ⬜ |

### Build Settings

| 項目 | 値 |
|------|-----|
| Framework Preset | Next.js |
| Root Directory | `packages/console` |
| Build Command | `npm run build` (デフォルト) |
| Output Directory | `.next` (デフォルト) |
| Install Command | `npm install` |

### モノレポ設定

Vercel は自動で pnpm ワークスペースを検出する。追加設定が必要な場合:

```json
// vercel.json (リポジトリルート)
{
  "buildCommand": "cd packages/console && npm run build",
  "outputDirectory": "packages/console/.next",
  "installCommand": "npm install"
}
```

---

## Step 6.3: 環境変数設定

**目的:** console に必要な環境変数を設定

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.3.1 | Project Settings | Settings → Environment Variables | ⬜ |
| 6.3.2 | NEXT_PUBLIC_SUPABASE_URL | Supabase プロジェクト URL | ⬜ |
| 6.3.3 | NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase Anon Key | ⬜ |
| 6.3.4 | API_URL | server の Tunnel URL | ⬜ |
| 6.3.5 | API_KEY (オプション) | server 認証用 | ⬜ |

### 環境変数一覧

| 変数名 | 値 | Environment |
|--------|-----|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...` | All |
| `API_URL` | `https://api.lifetracer.example.com` | All |
| `API_KEY` | `your-secret-key` (オプション) | All |

> **Note:** `NEXT_PUBLIC_` プレフィックスはクライアントサイドで使用する変数用

---

## Step 6.4: Serverless Function 実装

**目的:** server API を呼び出す Serverless Function を実装

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.4.1 | ディレクトリ作成 | `src/app/api/sync/[service]/` | ⬜ |
| 6.4.2 | route.ts 実装 | API プロキシ | ⬜ |
| 6.4.3 | 型定義 | リクエスト/レスポンス型 | ⬜ |

### ディレクトリ構造

```
packages/console/src/app/
├── api/
│   └── sync/
│       └── [service]/
│           └── route.ts      # POST /api/sync/toggl, /api/sync/gcal
├── page.tsx
└── ...
```

### src/app/api/sync/[service]/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL
const API_KEY = process.env.API_KEY

type SyncService = 'toggl' | 'gcal'

interface SyncRequest {
  startDate?: string
  endDate?: string
  fullSync?: boolean
}

interface SyncResponse {
  status: 'success' | 'error'
  result?: {
    success: boolean
    syncedCount: number
    message: string
  }
  error?: string
  timestamp: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ service: string }> }
): Promise<NextResponse<SyncResponse>> {
  const { service } = await params

  // バリデーション
  if (!['toggl', 'gcal'].includes(service)) {
    return NextResponse.json(
      {
        status: 'error',
        error: `Invalid service: ${service}`,
        timestamp: new Date().toISOString(),
      },
      { status: 400 }
    )
  }

  if (!API_URL) {
    return NextResponse.json(
      {
        status: 'error',
        error: 'API_URL is not configured',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }

  try {
    // リクエストボディ取得
    let body: SyncRequest = {}
    try {
      body = await request.json()
    } catch {
      // 空ボディの場合は無視
    }

    // server API 呼び出し
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (API_KEY) {
      headers['X-API-Key'] = API_KEY
    }

    const response = await fetch(`${API_URL}/api/sync/${service}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const data = await response.json()

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error(`Sync ${service} error:`, error)

    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

// GET はサポートしない
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  )
}
```

---

## Step 6.5: フロントエンド実装

**目的:** 同期ボタンから API を呼び出す UI を実装

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.5.1 | 同期ボタンコンポーネント | SyncButton.tsx | ⬜ |
| 6.5.2 | API クライアント | lib/api.ts | ⬜ |
| 6.5.3 | ダッシュボードに配置 | page.tsx 更新 | ⬜ |

### src/components/SyncButton.tsx

```typescript
'use client'

import { useState } from 'react'

interface SyncButtonProps {
  service: 'toggl' | 'gcal'
  label: string
}

export function SyncButton({ service, label }: SyncButtonProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleSync = async () => {
    setLoading(true)
    setResult(null)

    try {
      const response = await fetch(`/api/sync/${service}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const data = await response.json()

      if (data.status === 'success') {
        setResult(`✓ ${data.result?.message || 'Sync completed'}`)
      } else {
        setResult(`✗ ${data.error || 'Sync failed'}`)
      }
    } catch (error) {
      setResult(`✗ ${error instanceof Error ? error.message : 'Error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleSync}
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? 'Syncing...' : label}
      </button>
      {result && (
        <p className={result.startsWith('✓') ? 'text-green-600' : 'text-red-600'}>
          {result}
        </p>
      )}
    </div>
  )
}
```

### 使用例

```typescript
// src/app/page.tsx
import { SyncButton } from '@/components/SyncButton'

export default function Dashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-8">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 border rounded">
          <h2 className="font-semibold mb-4">Toggl Track</h2>
          <SyncButton service="toggl" label="Sync Toggl" />
        </div>

        <div className="p-4 border rounded">
          <h2 className="font-semibold mb-4">Google Calendar</h2>
          <SyncButton service="gcal" label="Sync Google Calendar" />
        </div>
      </div>
    </div>
  )
}
```

---

## Step 6.6: ローカル動作確認

**目的:** デプロイ前にローカルで動作確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 6.6.1 | 環境変数設定 | `.env.local` 作成 | ⬜ |
| 6.6.2 | 開発サーバー起動 | `npm run dev` | ⬜ |
| 6.6.3 | API テスト | `curl -X POST localhost:3000/api/sync/toggl` | ⬜ |
| 6.6.4 | UI テスト | ブラウザで確認 | ⬜ |

### .env.local

```bash
# packages/console/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
API_URL=https://api.lifetracer.example.com
API_KEY=your-secret-key
```

### 確認コマンド

```bash
cd packages/console

# 開発サーバー起動
npm run dev

# 別ターミナルでテスト
curl -X POST http://localhost:3000/api/sync/toggl
# {"status":"success","result":{...},"timestamp":"..."}
```

---

## Step 6.7: Vercel デプロイ

**目的:** 本番環境にデプロイ

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.7.1 | Git push | main ブランチに push | ⬜ |
| 6.7.2 | 自動デプロイ確認 | Vercel Dashboard で確認 | ⬜ |
| 6.7.3 | ビルドログ確認 | エラーがないか確認 | ⬜ |
| 6.7.4 | 本番 URL 確認 | xxx.vercel.app | ⬜ |

### 手動デプロイ（オプション）

```bash
# Vercel CLI インストール
npm i -g vercel

# デプロイ
cd packages/console
vercel --prod
```

---

## Step 6.8: カスタムドメイン設定（オプション）

**目的:** 独自ドメインで console にアクセス

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.8.1 | Vercel → Settings → Domains | ドメイン追加 | ⬜ |
| 6.8.2 | DNS 設定 | CNAME レコード追加 | ⬜ |
| 6.8.3 | SSL 確認 | 自動発行される | ⬜ |

### DNS 設定例

```
console.lifetracer.example.com CNAME cname.vercel-dns.com
```

---

## Step 6.9: 動作確認

**目的:** 本番環境での統合テスト

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 6.9.1 | console アクセス | ブラウザで確認 | ⬜ |
| 6.9.2 | ログイン確認 | Supabase Auth | ⬜ |
| 6.9.3 | 同期ボタンテスト | Toggl / GCal | ⬜ |
| 6.9.4 | Vercel Logs 確認 | エラーがないか | ⬜ |

### 確認フロー

1. `https://console.lifetracer.example.com` にアクセス
2. ログイン（Supabase Auth）
3. ダッシュボードが表示される
4. 「Sync Toggl」ボタンクリック
5. 成功メッセージが表示される
6. Vercel Logs でエラーがないことを確認

---

## 完了チェックリスト

- [ ] Vercel プロジェクトが作成された
- [ ] Root Directory: `packages/console` が設定された
- [ ] 環境変数がすべて設定された
- [ ] `src/app/api/sync/[service]/route.ts` が実装された
- [ ] ローカルで `/api/sync/toggl` が動作する
- [ ] Vercel デプロイが成功
- [ ] 本番 URL でアクセス可能
- [ ] 同期ボタンから server API 呼び出しが成功
- [ ] Vercel Logs にエラーなし

---

## トラブルシューティング

### ビルドエラー: モジュールが見つからない

```
Error: Cannot find module '@repo/xxx'
```

**解決策:** モノレポの依存関係を確認
```json
// packages/console/package.json
{
  "dependencies": {
    "@repo/database-types": "workspace:*"
  }
}
```

### API_URL が undefined

```
Error: API_URL is not configured
```

**解決策:** Vercel 環境変数を確認、再デプロイ

### CORS エラー

```
Access to fetch at 'https://api...' has been blocked by CORS policy
```

**解決策:** server (Hono) の CORS 設定を確認
```typescript
// packages/server/src/app.ts
import { cors } from 'hono/cors'
app.use('*', cors({
  origin: ['https://console.lifetracer.example.com'],
}))
```

---

## 次のステップ

→ [Phase 7: cron 設定 (日次レポート生成)](./infra-phase-7-cron-setup)
