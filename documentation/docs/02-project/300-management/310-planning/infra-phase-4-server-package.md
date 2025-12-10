---
title: "Phase 4: server パッケージ作成"
description: API Gateway (Hono) の実装
---

# Phase 4: server パッケージ作成

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | API Gateway (Hono) の実装、connector との統合 |
| 前提条件 | Phase 3 完了（infra ディレクトリ存在） |
| 成果物 | `packages/server/` パッケージ、Dockerfile |
| 想定作業 | TypeScript実装、Docker化 |

---

## Step 4.1: プロジェクト作成

**目的:** server パッケージの基本構造を作成

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 4.1.1 | ディレクトリ作成 | `mkdir -p packages/server/src` | ⬜ |
| 4.1.2 | package.json 作成 | 依存関係定義 | ⬜ |
| 4.1.3 | tsconfig.json 作成 | TypeScript設定 | ⬜ |
| 4.1.4 | project.json 作成 | Nx設定 | ⬜ |

### package.json

```json
{
  "name": "@repo/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0",
    "@hono/zod-validator": "^0.2.0",
    "@repo/connector": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### project.json

```json
{
  "name": "server",
  "projectType": "application",
  "sourceRoot": "packages/server/src",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/server",
        "command": "npm run build"
      },
      "dependsOn": ["^build"]
    },
    "dev": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/server",
        "command": "npm run dev"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/server",
        "command": "npm run typecheck"
      }
    }
  },
  "tags": ["scope:server", "type:app", "lang:ts"],
  "implicitDependencies": ["connector"]
}
```

---

## Step 4.2: エントリーポイント実装

**目的:** Hono アプリケーションの基本構造を実装

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 4.2.1 | src/index.ts 作成 | エントリーポイント | ⬜ |
| 4.2.2 | src/routes/ 作成 | ルート定義 | ⬜ |
| 4.2.3 | src/middleware/ 作成 | ミドルウェア | ⬜ |

### ディレクトリ構造

```
packages/server/
├── src/
│   ├── index.ts           # エントリーポイント
│   ├── app.ts             # Honoアプリ定義
│   ├── routes/
│   │   ├── index.ts       # ルートエクスポート
│   │   ├── health.ts      # ヘルスチェック
│   │   └── sync.ts        # 同期API
│   └── middleware/
│       ├── index.ts       # ミドルウェアエクスポート
│       ├── logger.ts      # リクエストログ
│       └── error.ts       # エラーハンドリング
├── Dockerfile
├── .dockerignore
├── package.json
├── tsconfig.json
└── project.json
```

### src/index.ts

```typescript
import { serve } from '@hono/node-server'
import { app } from './app.js'

const port = parseInt(process.env.PORT || '3000', 10)

console.log(`Starting server on port ${port}...`)

serve({
  fetch: app.fetch,
  port,
})

console.log(`Server running at http://localhost:${port}`)
```

### src/app.ts

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { healthRoutes } from './routes/health.js'
import { syncRoutes } from './routes/sync.js'
import { errorHandler } from './middleware/error.js'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())
app.onError(errorHandler)

// Routes
app.route('/health', healthRoutes)
app.route('/api/sync', syncRoutes)

// Root
app.get('/', (c) => {
  return c.json({
    name: '@repo/server',
    version: '0.0.1',
    endpoints: ['/health', '/api/sync/toggl', '/api/sync/gcal'],
  })
})

export { app }
```

---

## Step 4.3: ヘルスチェック実装

**目的:** サービス状態確認用エンドポイント

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 4.3.1 | GET /health 実装 | 基本ヘルスチェック | ⬜ |
| 4.3.2 | GET /health/ready 実装 | Readiness チェック | ⬜ |

### src/routes/health.ts

```typescript
import { Hono } from 'hono'

const healthRoutes = new Hono()

// 基本ヘルスチェック
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

// Readiness チェック (DB接続等を確認)
healthRoutes.get('/ready', async (c) => {
  try {
    // TODO: Supabase接続確認
    return c.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
      },
    })
  } catch (error) {
    return c.json(
      {
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      503
    )
  }
})

export { healthRoutes }
```

---

## Step 4.4: 同期 API 実装

**目的:** connector を呼び出す同期エンドポイント

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 4.4.1 | POST /api/sync/toggl 実装 | Toggl同期 | ⬜ |
| 4.4.2 | POST /api/sync/gcal 実装 | Google Calendar同期 | ⬜ |
| 4.4.3 | GET /api/sync/status 実装 | 同期状態確認 | ⬜ |

### src/routes/sync.ts

```typescript
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
// connector のエクスポートに依存
// import { syncToggl, syncGcal } from '@repo/connector'

const syncRoutes = new Hono()

// リクエストスキーマ
const syncRequestSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  fullSync: z.boolean().optional().default(false),
})

// Toggl 同期
syncRoutes.post(
  '/toggl',
  zValidator('json', syncRequestSchema),
  async (c) => {
    const params = c.req.valid('json')

    try {
      console.log('Starting Toggl sync...', params)

      // TODO: connector の syncToggl を呼び出し
      // const result = await syncToggl(params)

      // 仮実装
      const result = {
        success: true,
        syncedCount: 0,
        message: 'Toggl sync completed (stub)',
      }

      return c.json({
        status: 'success',
        result,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Toggl sync error:', error)
      return c.json(
        {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
        500
      )
    }
  }
)

// Google Calendar 同期
syncRoutes.post(
  '/gcal',
  zValidator('json', syncRequestSchema),
  async (c) => {
    const params = c.req.valid('json')

    try {
      console.log('Starting Google Calendar sync...', params)

      // TODO: connector の syncGcal を呼び出し
      // const result = await syncGcal(params)

      // 仮実装
      const result = {
        success: true,
        syncedCount: 0,
        message: 'Google Calendar sync completed (stub)',
      }

      return c.json({
        status: 'success',
        result,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Google Calendar sync error:', error)
      return c.json(
        {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
        500
      )
    }
  }
)

// 同期状態確認
syncRoutes.get('/status', async (c) => {
  // TODO: 最後の同期結果を取得
  return c.json({
    toggl: {
      lastSync: null,
      status: 'unknown',
    },
    gcal: {
      lastSync: null,
      status: 'unknown',
    },
  })
})

export { syncRoutes }
```

---

## Step 4.5: ミドルウェア実装

**目的:** エラーハンドリング、認証等

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 4.5.1 | エラーハンドラ実装 | グローバルエラー処理 | ⬜ |
| 4.5.2 | 認証ミドルウェア実装 | API Key / Bearer Token | ⬜ |

### src/middleware/error.ts

```typescript
import { Context } from 'hono'

export const errorHandler = (err: Error, c: Context) => {
  console.error('Unhandled error:', err)

  return c.json(
    {
      status: 'error',
      error: err.message || 'Internal Server Error',
      timestamp: new Date().toISOString(),
    },
    500
  )
}
```

### src/middleware/auth.ts (オプション)

```typescript
import { createMiddleware } from 'hono/factory'

export const apiKeyAuth = createMiddleware(async (c, next) => {
  const apiKey = c.req.header('X-API-Key')
  const expectedKey = process.env.API_KEY

  if (!expectedKey) {
    // API Key 未設定時はスキップ
    await next()
    return
  }

  if (apiKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
```

---

## Step 4.6: Dockerfile 作成

**目的:** コンテナイメージをビルド

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 4.6.1 | Dockerfile 作成 | マルチステージビルド | ⬜ |
| 4.6.2 | .dockerignore 作成 | 除外ファイル設定 | ⬜ |
| 4.6.3 | ローカルビルドテスト | `docker build` | ⬜ |

### Dockerfile

```dockerfile
# packages/server/Dockerfile
FROM --platform=linux/arm64 node:20-slim AS base

# Install pnpm
RUN npm install -g pnpm

# ================================
# Dependencies stage
# ================================
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY packages/server/package.json ./packages/server/
COPY packages/connector/package.json ./packages/connector/
COPY packages/database-types/package.json ./packages/database-types/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ================================
# Builder stage
# ================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/packages/connector/node_modules ./packages/connector/node_modules

# Copy source
COPY tsconfig.base.json ./
COPY packages/database-types ./packages/database-types
COPY packages/connector ./packages/connector
COPY packages/server ./packages/server

# Build
WORKDIR /app/packages/connector
RUN pnpm build

WORKDIR /app/packages/server
RUN pnpm build

# ================================
# Runner stage
# ================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 hono

# Copy built files
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/node_modules ./node_modules

USER hono

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### .dockerignore

```
# packages/server/.dockerignore
node_modules
dist
*.log
.env
.env.*
!.env.example
Dockerfile
.dockerignore
*.md
.git
.gitignore
tests
__tests__
*.test.ts
*.spec.ts
```

---

## Step 4.7: ローカル動作確認

**目的:** 開発環境で動作確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 4.7.1 | 依存関係インストール | `pnpm install` | ⬜ |
| 4.7.2 | 開発サーバー起動 | `nx dev server` | ⬜ |
| 4.7.3 | ヘルスチェック確認 | `curl localhost:3000/health` | ⬜ |
| 4.7.4 | 同期API確認 | `curl -X POST localhost:3000/api/sync/toggl` | ⬜ |

### 確認コマンド

```bash
# ヘルスチェック
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2025-XX-XXTXX:XX:XX.XXXZ"}

# ルート情報
curl http://localhost:3000/
# {"name":"@repo/server","version":"0.0.1","endpoints":[...]}

# Toggl同期
curl -X POST http://localhost:3000/api/sync/toggl \
  -H "Content-Type: application/json" \
  -d '{}'
# {"status":"success","result":{...},"timestamp":"..."}
```

---

## Step 4.8: Docker ビルドテスト

**目的:** コンテナとして正常に動作することを確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 4.8.1 | イメージビルド | `docker build -t server:dev .` | ⬜ |
| 4.8.2 | コンテナ起動 | `docker run -p 3000:3000 server:dev` | ⬜ |
| 4.8.3 | 動作確認 | `curl localhost:3000/health` | ⬜ |

### ビルドコマンド

```bash
# packages/server ディレクトリで実行
cd packages/server

# リポジトリルートのコンテキストでビルド
docker build -t server:dev -f Dockerfile ../..

# 起動
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  server:dev

# 確認
curl http://localhost:3000/health
```

---

## 完了チェックリスト

- [ ] `packages/server/` ディレクトリが作成された
- [ ] `package.json` に `@repo/connector` 依存が含まれる
- [ ] `tsconfig.json` が設定された
- [ ] `project.json` が作成された
- [ ] `src/index.ts` エントリーポイントが実装された
- [ ] `GET /health` が動作する
- [ ] `POST /api/sync/toggl` が動作する（stub）
- [ ] `POST /api/sync/gcal` が動作する（stub）
- [ ] `Dockerfile` が作成された
- [ ] `.dockerignore` が作成された
- [ ] `docker build` が成功する
- [ ] コンテナ起動後 `/health` が応答する
- [ ] Git コミット完了

---

## 次のステップ

→ [Phase 5: Cloudflare Tunnel 設定](./infra-phase-5-cloudflare-tunnel)

---

## 補足: connector との統合

server から connector を呼び出すには、connector パッケージで以下のエクスポートが必要:

```typescript
// packages/connector/src/index.ts
export { syncToggl } from './services/toggl-track/sync.js'
export { syncGcal } from './services/google-calendar/sync.js'
```

現状の connector が CLI ベースの場合、ライブラリとして使用できるようリファクタリングが必要になる可能性がある。
