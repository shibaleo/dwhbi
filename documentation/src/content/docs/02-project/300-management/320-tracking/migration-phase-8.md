---
title: "Phase 8: connector の TypeScript 移行"
description: connector を Python から Node.js + TypeScript へトランスレーションする移行フェーズ
---

# Phase 8: connector の TypeScript 移行

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | connector を Python から Node.js + TypeScript へ移行 |
| 前提条件 | Phase 7 完了、connector の機能が安定している |
| 成果物 | TypeScript 版 `packages/connector/` |

## 移行理由

| 観点 | Python | Node.js + TypeScript |
|------|--------|----------------------|
| 型安全性 | 実行時エラー | コンパイル時チェック |
| database-types | 使用不可 | `@repo/database-types` 共有 |
| エコシステム | requests, httpx | fetch, axios |
| 実行環境 | Python 3.12 + venv | Node.js (Vercel Edge 対応) |
| CI/CD | 別途 Python 環境構築 | npm のみで統一 |

## タスク一覧

---

### 8.1 プロジェクト構造の準備

```bash
# 既存の Python コードをバックアップ
git mv packages/connector packages/connector-python

# 新しい TypeScript プロジェクト作成
mkdir -p packages/connector/src/services
mkdir -p packages/connector/__tests__
```

### 8.2 package.json 作成

```json
// packages/connector/package.json
{
  "name": "@repo/connector",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "types": "./dist/main.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/main.ts",
    "test": "vitest",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@repo/database-types": "workspace:*",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "vitest": "^1.0.0",
    "eslint": "^8.0.0"
  }
}
```

### 8.3 tsconfig.json 作成

```json
// packages/connector/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

### 8.4 project.json 更新

```json
// packages/connector/project.json
{
  "name": "connector",
  "projectType": "application",
  "sourceRoot": "packages/connector/src",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "tsc"
      }
    },
    "dev": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "tsx watch src/main.ts"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "vitest run"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "eslint src/"
      }
    },
    "sync:gcalendar": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "tsx src/services/google_calendar/main.ts"
      }
    },
    "sync:toggl": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/connector",
        "command": "tsx src/services/toggl_track/main.ts"
      }
    }
  },
  "tags": ["scope:connector", "type:app", "lang:typescript"],
  "implicitDependencies": ["database-types"]
}
```

---

### 8.5 コードトランスレーション

#### 8.5.1 ディレクトリ構造

```
packages/connector/
├── src/
│   ├── main.ts              # エントリーポイント
│   ├── db/
│   │   └── client.ts        # Supabase クライアント
│   ├── lib/
│   │   ├── fetcher.ts       # HTTP クライアント
│   │   └── utils.ts         # ユーティリティ
│   └── services/
│       ├── google_calendar/
│       │   ├── main.ts
│       │   ├── client.ts
│       │   └── types.ts
│       ├── toggl_track/
│       │   ├── main.ts
│       │   ├── client.ts
│       │   └── types.ts
│       └── ...
├── __tests__/
│   ├── services/
│   │   ├── google_calendar.test.ts
│   │   └── toggl_track.test.ts
│   └── setup.ts
├── package.json
├── tsconfig.json
└── project.json
```

#### 8.5.2 Supabase クライアント

```typescript
// packages/connector/src/db/client.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@repo/database-types'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseKey)
```

#### 8.5.3 サービス実装例

```typescript
// packages/connector/src/services/toggl_track/client.ts
import type { Tables, TablesInsert } from '@repo/database-types'

export interface TogglTimeEntry {
  id: number
  description: string
  start: string
  stop: string
  duration: number
  project_id: number | null
}

export async function fetchTimeEntries(
  apiToken: string,
  startDate: string,
  endDate: string
): Promise<TogglTimeEntry[]> {
  const response = await fetch(
    `https://api.track.toggl.com/api/v9/me/time_entries?start_date=${startDate}&end_date=${endDate}`,
    {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${apiToken}:api_token`).toString('base64')}`,
        'Content-Type': 'application/json'
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Toggl API error: ${response.status}`)
  }

  return response.json()
}

export function transformToInsert(
  entry: TogglTimeEntry
): TablesInsert<'toggl_time_entries'> {
  return {
    toggl_id: entry.id,
    description: entry.description,
    start_time: entry.start,
    end_time: entry.stop,
    duration_seconds: entry.duration,
    project_id: entry.project_id
  }
}
```

---

### 8.6 テスト移行

```typescript
// packages/connector/__tests__/services/toggl_track.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchTimeEntries, transformToInsert } from '../../src/services/toggl_track/client'

describe('Toggl Track Service', () => {
  it('transforms API response to insert format', () => {
    const apiEntry = {
      id: 123,
      description: 'Test task',
      start: '2024-01-01T09:00:00Z',
      stop: '2024-01-01T10:00:00Z',
      duration: 3600,
      project_id: 456
    }

    const result = transformToInsert(apiEntry)

    expect(result.toggl_id).toBe(123)
    expect(result.duration_seconds).toBe(3600)
  })
})
```

---

### 8.7 Python コードの削除

移行が完了し、テストが通ったら:

```bash
# Python バックアップを削除
rm -rf packages/connector-python
```

---

## 検証手順

### 動作確認

```bash
# ビルド
npx nx build connector

# テスト
npx nx test connector

# 型チェック
npx nx run connector:typecheck

# 個別サービス実行
npx nx run connector:sync:toggl
```

### チェックリスト

- [ ] 全サービスが TypeScript に移行されている
- [ ] `@repo/database-types` からの型インポートが動作する
- [ ] 全テストが通る
- [ ] ビルドが成功する
- [ ] 実際のAPI呼び出しが動作する

## ロールバック手順

```bash
# TypeScript 版を削除
rm -rf packages/connector

# Python バックアップを復元
git mv packages/connector-python packages/connector

# project.json を Python 版に戻す
# （Phase 3 の設定を参照）
```

## 完了条件

以下がすべて満たされたら Phase 8 完了:

1. 全サービスが TypeScript で実装されている
2. database-types との型連携が動作している
3. 全テストが通る
4. CI/CD パイプラインが動作する
5. Python コードが削除されている

## 関連ドキュメント

- [モノレポ移行計画](/02-project/300-management/310-status/migration-plan) - 全体計画
- [Phase 3: 既存プロジェクトの移行](/02-project/300-management/310-status/migration-phase-3) - Python 版 connector
- [ADR-005 モノレポ構成](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 設計決定
