---
title: personal-context Hono移行計画
description: MCPサーバー personal-context のHonoフレームワーク導入計画
status: 完了
---

# personal-context Hono移行計画

## 概要

Supabase Edge Function `personal-context` に Hono フレームワークを導入し、ルーティング・ミドルウェア処理を簡素化する。

## 背景

### 現状（移行前）

- 自前でルーティング・CORS・認証を実装
- MCPプロトコル処理は自前実装（維持する）
- 約400行のコードで管理可能だが、Honoで簡素化の余地あり

### 決定事項

| 項目 | 判断 | 理由 |
|------|------|------|
| Hono | 導入する | 成熟、軽量、Deno公式サポート |
| mcp-lite | 導入しない | 23件のopen issue、v0.x、SSEバグあり |
| 認証方式 | 現行維持 | 公式より先進的（OAuth Protected Resource対応済） |
| MCPプロトコル | 現行維持 | 自前実装で完全制御 |

---

## 最終構成

### ディレクトリ構成

```
supabase/functions/personal-context/
├── index.ts              # エントリーポイント（v1/v2切り替え）
├── deno.json             # 依存定義（Hono追加）
├── v1/
│   └── handler.ts        # 旧バージョン（自前ルーティング）
├── v2/
│   ├── app.ts            # Honoアプリ定義
│   ├── handler.ts        # MCPリクエストハンドラ
│   └── middleware/
│       └── auth.ts       # 認証ミドルウェア
├── mcp/
│   ├── handler.ts        # MCPリクエストハンドラ（v1用）
│   ├── protocol.ts       # プロトコル処理（共通）
│   └── types.ts          # 型定義（共通）
├── rag/
│   ├── tools.ts          # RAGツール定義（9ツール）
│   ├── repository.ts     # データアクセス
│   └── embedder.ts       # Voyage AI埋め込み
├── supabase/
│   ├── tools.ts          # Supabase管理ツール（16ツール）
│   └── api.ts            # Management API クライアント
└── auth/
    └── validator.ts      # 認証バリデータ（v1用）
```

### フラグ切り替え

`index.ts` で `USE_V2 = true` により Hono版を使用：

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

---

## 実装詳細

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

### v2/app.ts（Honoアプリ）

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.ts";
import { handleMcpRequest } from "./handler.ts";

export const app = new Hono();

// CORS ミドルウェア
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

// OAuth Protected Resource メタデータ（認証不要）
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
  // 同上
});

// 認証ミドルウェア（以降のルートに適用）
app.use("*", authMiddleware);

// MCP エンドポイント
app.post("/", (c) => handleMcpRequest(c));
app.get("/", (c) => handleMcpRequest(c));
app.delete("/", (c) => handleMcpRequest(c));

// Supabase Edge Function ルーティング対応
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

type Variables = {
  userId: string;
};

export const authMiddleware = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

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

      c.set("userId", user.id);
      return next();
    } catch (error) {
      console.error("Token validation error:", error);
      return createUnauthorizedResponse(c);
    }
  }
);

function createUnauthorizedResponse(c: Context): Response {
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

### v2/handler.ts（MCPハンドラ）

Hono Context を受け取り、MCP Streamable HTTP Transport に対応：

- `POST /`: JSON-RPC リクエスト処理
- `GET /`: SSE ストリーム開始
- `DELETE /`: セッション終了

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

## 完了状況

### 完了項目

- [x] v2ディレクトリ構成作成（`v2/app.ts`, `v2/handler.ts`, `v2/middleware/auth.ts`）
- [x] deno.json に Hono 依存追加
- [x] CORS ミドルウェア導入
- [x] 認証ミドルウェア実装
- [x] MCP Streamable HTTP Transport 対応
- [x] v1/v2 フラグ切り替え機能
- [x] 本番デプロイ完了
- [x] Claude Code から動作確認完了
- [x] 全25ツール動作確認

### 削除対象（今後）

| ファイル | 理由 |
|----------|------|
| `v1/handler.ts` | Hono版で完全置換後 |
| `auth/validator.ts` | `v2/middleware/auth.ts` で置換 |
| `mcp/handler.ts` | `v2/handler.ts` で置換 |

---

## 関連ドキュメント

- [personal-context-v2-hono-design.md](/01-product/100-development/130-design/personal-context-v2-hono-design) - 詳細設計
- [Hono公式ドキュメント](https://hono.dev/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [MCP仕様](https://modelcontextprotocol.io/)
