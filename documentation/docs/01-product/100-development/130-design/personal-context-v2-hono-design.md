---
title: Personal Context v2 (Hono版) 詳細設計書
description: MCPサーバー personal-context のHonoフレームワーク移行に関する詳細設計
status: 完了
---

# Personal Context v2 (Hono版) 詳細設計書

## 概要

本ドキュメントは [personal-context-hono-migration.md](/02-project/300-management/310-planning/personal-context-hono-migration) に基づき、既存の `personal-context` Edge Function に Hono フレームワークを導入した最終実装を記述する。

### 移行の目的

1. **コード簡素化**: 手動ルーティング・CORS処理をHonoミドルウェアで置換
2. **保守性向上**: 標準的なWebフレームワークパターンの採用
3. **拡張性確保**: ミドルウェアチェーンによる機能追加の容易化

### 設計方針

| 項目 | 方針 | 理由 |
|------|------|------|
| Hono | 導入する | 成熟・軽量・Deno公式サポート |
| mcp-lite | 導入しない | v0.x、23件のopen issue、SSEバグあり |
| MCPプロトコル実装 | 現行維持 | 自前実装で完全制御、安定稼働中 |
| 認証方式 | 現行維持 | 公式より先進的（OAuth Protected Resource対応済） |

---

## アーキテクチャ

### 最終構成

```
supabase/functions/personal-context/
├── index.ts                  # エントリーポイント（v1/v2切り替え）
├── deno.json                 # 依存定義（Hono追加）
│
├── v1/
│   └── handler.ts            # 旧バージョン（フォールバック用）
│
├── v2/
│   ├── app.ts                # Honoアプリ定義
│   ├── handler.ts            # MCPリクエストハンドラ
│   └── middleware/
│       └── auth.ts           # 認証ミドルウェア
│
├── mcp/
│   ├── handler.ts            # MCPリクエストハンドラ（v1用）
│   ├── protocol.ts           # プロトコル処理（共通）
│   └── types.ts              # 型定義（共通）
│
├── rag/
│   ├── tools.ts              # RAGツール定義（9ツール）
│   ├── repository.ts         # データアクセス
│   └── embedder.ts           # Voyage AI埋め込み
│
├── supabase/
│   ├── tools.ts              # Supabase管理ツール（16ツール）
│   └── api.ts                # Management API クライアント
│
└── auth/
    └── validator.ts          # 認証バリデータ（v1用）
```

### エンドポイント

| URL | 説明 |
|-----|------|
| `https://<ref>.supabase.co/functions/v1/personal-context` | 本番エンドポイント |

### リクエストフロー

```
Client Request
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ Hono App (v2/app.ts)                                        │
├─────────────────────────────────────────────────────────────┤
│ cors() middleware ─────────────────────────────────────────▶│ OPTIONS → 200
│    │                                                         │
│    ▼                                                         │
│ /.well-known/oauth-protected-resource ─────────────────────▶│ メタデータ返却
│    │                                                         │
│    ▼                                                         │
│ authMiddleware ────────────────────────────────────────────▶│ 401 + WWW-Authenticate
│    │ ✓ valid                                                 │
│    ▼                                                         │
│ POST/GET/DELETE / ─────────────────────────────────────────▶│ MCP処理
└─────────────────────────────────────────────────────────────┘
```

---

## 実装詳細

### index.ts

```typescript
import { handleV1Request } from "./v1/handler.ts";
import { rootApp } from "./v2/app.ts";

const USE_V2 = true;

Deno.serve(async (req: Request) => {
  if (USE_V2) {
    return rootApp.fetch(req);
  }
  return handleV1Request(req);
});
```

### deno.json

```json
{
  "compilerOptions": {
    "lib": ["deno.window", "deno.ns"],
    "strict": true
  },
  "imports": {
    "hono": "npm:hono@^4",
    "hono/cors": "npm:hono@^4/cors",
    "hono/factory": "npm:hono@^4/factory",
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
  }
}
```

### v2/app.ts

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.ts";
import { handleMcpRequest } from "./handler.ts";

export const app = new Hono();

// =============================================================================
// CORS ミドルウェア
// =============================================================================
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "X-Client-Info",
      "Apikey",
      "Mcp-Session-Id",
    ],
    allowMethods: ["POST", "GET", "OPTIONS", "DELETE"],
    exposeHeaders: ["Mcp-Session-Id"],
  })
);

// =============================================================================
// OAuth Protected Resource メタデータ（認証不要）
// =============================================================================
app.get("/.well-known/oauth-protected-resource", (c) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  return c.json({
    resource: `${supabaseUrl}/functions/v1/personal-context`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  });
});

// パスに関係なく .well-known をキャッチ（互換性）
app.get("*/.well-known/oauth-protected-resource", (c) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  return c.json({
    resource: `${supabaseUrl}/functions/v1/personal-context`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  });
});

// =============================================================================
// 認証ミドルウェア（以降のルートに適用）
// =============================================================================
app.use("*", authMiddleware);

// =============================================================================
// MCP エンドポイント
// =============================================================================
app.post("/", (c) => handleMcpRequest(c));
app.get("/", (c) => handleMcpRequest(c));
app.delete("/", (c) => handleMcpRequest(c));

// =============================================================================
// Supabase Edge Function ルーティング対応
// =============================================================================
const rootApp = new Hono();
rootApp.route("/personal-context", app);
rootApp.route("/", app);

export { rootApp };
```

### v2/middleware/auth.ts

```typescript
import { createMiddleware } from "hono/factory";
import { Context } from "hono";
import { createClient } from "@supabase/supabase-js";

// =============================================================================
// 型定義
// =============================================================================
type Variables = {
  userId: string;
};

// =============================================================================
// 認証ミドルウェア
// =============================================================================
export const authMiddleware = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Bearerトークンチェック
    if (!authHeader?.startsWith("Bearer ")) {
      return createUnauthorizedResponse(c);
    }

    const token = authHeader.substring(7);

    try {
      // Service Role Key チェック（テスト/内部用）
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceRoleKey && token === serviceRoleKey) {
        c.set("userId", "service-role");
        return next();
      }

      // ユーザートークン検証
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        console.error("Token validation failed:", error?.message);
        return createUnauthorizedResponse(c);
      }

      // 認証成功 - userIdをコンテキストにセット
      c.set("userId", user.id);
      return next();
    } catch (error) {
      console.error("Token validation error:", error);
      return createUnauthorizedResponse(c);
    }
  }
);

// =============================================================================
// 401レスポンス生成
// =============================================================================
function createUnauthorizedResponse(c: Context): Response {
  // Resource MetadataはVercel (console)にある
  const resourceMetadataUrl =
    "https://dwhbi-console.vercel.app/.well-known/oauth-protected-resource";

  return c.json(
    { error: "Unauthorized" },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    }
  );
}
```

### v2/handler.ts

```typescript
import { Context } from "hono";
import { processRequest } from "../mcp/protocol.ts";
import { McpRequest } from "../mcp/types.ts";

// Streamable HTTP Transport (MCP 2025-06-18) 対応
const MCP_SESSION_HEADER = "mcp-session-id";

// =============================================================================
// MCPリクエストハンドラ
// =============================================================================
export async function handleMcpRequest(c: Context): Promise<Response> {
  const req = c.req.raw;
  const userId = c.get("userId") as string;

  const contentType = c.req.header("content-type") || "";
  const accept = c.req.header("accept") || "";
  const sessionId = c.req.header(MCP_SESSION_HEADER);

  // GETリクエスト: SSEストリーム開始（Streamable HTTP Transport）
  if (req.method === "GET") {
    if (accept.includes("text/event-stream")) {
      return handleSseStream(sessionId);
    }
    return c.json({ error: "Method not allowed" }, 405);
  }

  // DELETEリクエスト: セッション終了
  if (req.method === "DELETE") {
    return new Response(null, { status: 204 });
  }

  // POSTリクエスト: JSON-RPC処理
  if (req.method === "POST") {
    // SSEレスポンスを期待する場合
    if (accept.includes("text/event-stream")) {
      return handleSseRequest(c, userId, sessionId);
    }

    // 通常のJSON-RPC
    if (contentType.includes("application/json")) {
      return handleJsonRpcRequest(c, userId, sessionId);
    }
  }

  return c.json({ error: "Unsupported content type" }, 400);
}

// =============================================================================
// JSON-RPC リクエスト処理
// =============================================================================
async function handleJsonRpcRequest(
  c: Context,
  userId: string,
  sessionId: string | null
): Promise<Response> {
  const body = (await c.req.json()) as McpRequest | McpRequest[];

  // レスポンスヘッダー
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // セッションIDを返す（Streamable HTTP Transport）
  if (sessionId) {
    headers[MCP_SESSION_HEADER] = sessionId;
  }

  // バッチリクエスト対応
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((request) => processRequest(request, userId))
    );
    return c.json(responses, 200, headers);
  }

  // 通知（idなし）の場合は202 Accepted
  if (!body.id) {
    await processRequest(body, userId);
    return new Response(null, { status: 202, headers });
  }

  const response = await processRequest(body, userId);
  return c.json(response, 200, headers);
}

// =============================================================================
// SSE リクエスト処理
// =============================================================================
async function handleSseRequest(
  c: Context,
  userId: string,
  sessionId: string | null
): Promise<Response> {
  const body = (await c.req.json()) as McpRequest;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await processRequest(body, userId);
        const data = `data: ${JSON.stringify(response)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      } catch (error) {
        const errorData = `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(errorData));
      } finally {
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  if (sessionId) {
    headers[MCP_SESSION_HEADER] = sessionId;
  }

  return new Response(stream, { headers });
}

// =============================================================================
// SSE ストリーム（GETリクエスト用）
// =============================================================================
function handleSseStream(sessionId: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  if (sessionId) {
    headers[MCP_SESSION_HEADER] = sessionId;
  }

  // 空のストリームを返す（サーバーからの非同期通知が必要な場合に使用）
  const stream = new ReadableStream({
    start(controller) {
      // Keep-aliveのためのコメント送信
      const keepAlive = `: keep-alive\n\n`;
      controller.enqueue(new TextEncoder().encode(keepAlive));
    },
  });

  return new Response(stream, { headers });
}
```

---

## ツール一覧（25ツール）

### RAGツール（9ツール）

| ツール名 | 説明 |
|----------|------|
| `search_docs` | セマンティック検索 |
| `get_doc` | ドキュメント取得 |
| `list_tags` | タグ一覧 |
| `list_docs_by_tag` | タグでフィルタ |
| `list_all_docs` | 全ドキュメント一覧 |
| `search_by_keyword` | キーワード検索 |
| `search_by_title` | タイトル検索 |
| `list_docs_by_date` | 日付順一覧 |
| `list_docs_by_frontmatter_date` | frontmatter日付順一覧 |

### Supabase管理ツール（16ツール）

| ツール名 | 説明 |
|----------|------|
| `sb_list_tables` | テーブル一覧 |
| `sb_execute_sql` | SQL実行 |
| `sb_list_migrations` | マイグレーション一覧 |
| `sb_apply_migration` | マイグレーション適用 |
| `sb_list_organizations` | 組織一覧 |
| `sb_list_projects` | プロジェクト一覧 |
| `sb_get_project` | プロジェクト詳細 |
| `sb_get_logs` | ログ取得 |
| `sb_get_security_advisors` | セキュリティ推奨事項 |
| `sb_get_performance_advisors` | パフォーマンス推奨事項 |
| `sb_get_project_url` | プロジェクトURL |
| `sb_get_api_keys` | APIキー情報 |
| `sb_generate_typescript_types` | TypeScript型生成 |
| `sb_list_edge_functions` | Edge Function一覧 |
| `sb_get_edge_function` | Edge Function詳細 |
| `sb_list_storage_buckets` | ストレージバケット一覧 |
| `sb_get_storage_config` | ストレージ設定 |

---

## 認証フロー

```
┌─────────────────────────────────────────────────────────────┐
│ 認証フロー                                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Client → Edge Function (Bearer token なし)              │
│     └─▶ 401 + WWW-Authenticate: Bearer resource_metadata=  │
│         "https://dwhbi-console.vercel.app/..."              │
│                                                             │
│  2. Client → Vercel (/.well-known/oauth-protected-resource) │
│     └─▶ authorization_servers: [Supabase Auth URL]         │
│                                                             │
│  3. Client → Supabase Auth (OAuth 2.1 + PKCE)               │
│     └─▶ Access Token 発行                                  │
│                                                             │
│  4. Client → Edge Function (Bearer <access_token>)          │
│     └─▶ supabase.auth.getUser() でトークン検証             │
│     └─▶ userId をコンテキストにセット                      │
│     └─▶ MCP処理実行                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## デプロイ手順

### ローカル開発

```bash
# Supabase起動
supabase start

# 関数をserve（--no-verify-jwt 必須）
supabase functions serve personal-context --no-verify-jwt

# テストエンドポイント
# http://localhost:54321/functions/v1/personal-context
```

### 本番デプロイ

```bash
# デプロイ
supabase functions deploy personal-context --no-verify-jwt

# ログ確認
supabase functions logs personal-context

# 本番エンドポイント
# https://<ref>.supabase.co/functions/v1/personal-context
```

---

## 完了チェックリスト

### 完了項目

- [x] v2ディレクトリ構成作成
- [x] deno.json に Hono 依存追加
- [x] CORS ミドルウェア導入
- [x] 認証ミドルウェア実装
- [x] MCP Streamable HTTP Transport 対応
- [x] v1/v2 フラグ切り替え機能
- [x] 本番デプロイ完了
- [x] Claude Code から動作確認完了
- [x] 全25ツール動作確認

---

## 関連ドキュメント

- [personal-context-hono-migration.md](/02-project/300-management/310-planning/personal-context-hono-migration) - 移行計画
- [personal-context-edge-function-design.md](./personal-context-edge-function-design.md) - 現行版設計
- [supabase-mcp-remote-design.md](./supabase-mcp-remote-design.md) - Supabase管理ツール設計
- [Hono公式ドキュメント](https://hono.dev/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
