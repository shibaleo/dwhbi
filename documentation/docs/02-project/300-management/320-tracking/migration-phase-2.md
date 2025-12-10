---
title: "Phase 2: 共有ライブラリ作成"
description: Supabase 型定義の共有基盤を構築する移行フェーズ
---

# Phase 2: 共有ライブラリ作成

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | 型定義の共有基盤を構築 |
| 前提条件 | Phase 1 完了 |
| 成果物 | `packages/database-types/` |

## タスク一覧

### 2.1 ディレクトリ構造作成

```bash
mkdir -p packages/database-types/src
```

### 2.2 package.json 作成

```json
// packages/database-types/package.json
{
  "name": "@repo/database-types",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 2.3 project.json 作成

```json
// packages/database-types/project.json
{
  "name": "database-types",
  "projectType": "library",
  "sourceRoot": "packages/database-types/src",
  "targets": {
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/database-types",
        "command": "tsc --noEmit"
      }
    }
  },
  "tags": ["scope:shared", "type:lib"]
}
```

### 2.4 tsconfig.json 作成

```json
// packages/database-types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 2.5 index.ts 作成

```typescript
// packages/database-types/src/index.ts
export * from './database'
export * from './extensions'
```

### 2.6 Supabase 型生成

```bash
# supabase/ ディレクトリで実行
cd supabase

# ローカル Supabase から型生成
supabase gen types typescript --local > ../packages/database-types/src/database.ts
```

**生成される型の例:**

```typescript
// packages/database-types/src/database.ts (自動生成)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      // テーブル定義...
    }
    Views: {
      // ビュー定義...
    }
    Functions: {
      // 関数定義...
    }
    Enums: {
      // Enum 定義...
    }
  }
}
```

### 2.7 extensions.ts 作成

```typescript
// packages/database-types/src/extensions.ts
import type { Database } from './database'

// テーブル型のショートカット
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// Enum 型のショートカット
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// よく使う型のエイリアス（プロジェクトに合わせてカスタマイズ）
// export type TimeRecord = Tables<'time_records'>
// export type Target = Tables<'targets'>
```

### 2.8 型生成スクリプト追加

```json
// package.json（ルート）に追加
{
  "scripts": {
    "gen:types": "cd supabase && supabase gen types typescript --local > ../packages/database-types/src/database.ts"
  }
}
```

## 検証手順

### 型チェック

```bash
# database-types の型チェック
npx nx typecheck database-types

# または直接
cd packages/database-types
npx tsc --noEmit
```

### 依存グラフ確認

```bash
npx nx graph
```

database-types がグラフに表示されることを確認。

### チェックリスト

- [ ] `packages/database-types/` ディレクトリが存在する
- [ ] `packages/database-types/src/database.ts` に型が生成されている
- [ ] `packages/database-types/src/index.ts` がエクスポートしている
- [ ] `npx nx typecheck database-types` が成功する
- [ ] `npx nx graph` で database-types が表示される

## 型の使用例

他のプロジェクトからの参照方法:

```typescript
// packages/connector/src/example.ts
import { Database, Tables, InsertTables } from '@repo/database-types'

// テーブルの行型
type TimeRecord = Tables<'time_records'>

// Insert 用の型
type NewTimeRecord = InsertTables<'time_records'>

// Supabase クライアントの型付け
import { createClient } from '@supabase/supabase-js'
const supabase = createClient<Database>(url, key)
```

## ロールバック手順

```bash
# database-types パッケージを削除
rm -rf packages/database-types

# ルート package.json から gen:types スクリプトを削除
# 手動で編集
```

## 完了条件

以下がすべて満たされたら Phase 2 完了:

1. `packages/database-types/` が作成されている
2. Supabase から型が正しく生成されている
3. `index.ts` が型をエクスポートしている
4. `extensions.ts` にユーティリティ型がある
5. 型チェックが成功する

## 次のフェーズ

[Phase 3: 既存プロジェクトの移行](/02-project/300-management/320-tracking/migration-phase-3)

## 関連ドキュメント

- [モノレポ移行計画](/02-project/300-management/310-planning/migration-plan) - 全体計画
- [Phase 1: 基盤整備](/02-project/300-management/320-tracking/migration-phase-1) - 前のフェーズ
- [Supabase TypeScript 型生成](https://supabase.com/docs/guides/api/rest/generating-types)
