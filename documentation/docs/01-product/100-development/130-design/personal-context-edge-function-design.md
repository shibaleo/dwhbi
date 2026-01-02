---
title: Personal Context Edge Function 詳細設計書
description: MCPサーバーをSupabase Edge Functionsに移行するための詳細設計
status: Phase 1, 3, 4, Supabase Tools 完了
---

# Personal Context Edge Function 詳細設計書

## 概要

本ドキュメントは [ADR-010](./131-decisions/adr_010-mcp-server-separation.md) に基づき、MCPサーバーをconsole（Next.js/Vercel）からSupabase Edge Functionsに移行するための詳細設計を記述する。

> **実装状況**: Phase 1（RAG移植）、Phase 3（OAuth設定）、Phase 4（クリーンアップ）、Supabase Tools（16ツール）完了。
> Phase 2（KG・Activity）は未着手。

### 移行の目的

1. **パフォーマンス向上**: DB接続・認証が同一インフラで高速化（50-200ms → 1-10ms）
2. **デプロイ独立性**: console再デプロイ不要
3. **コスト効率**: Vercel課金不要

### 技術スタック

| 項目 | 現行（console） | 移行後（Edge Function） |
|------|----------------|------------------------|
| ランタイム | Node.js | Deno |
| フレームワーク | Next.js API Route | Supabase Edge Functions |
| MCP実装 | @modelcontextprotocol/sdk | 直接HTTP実装 |
| DB接続 | @supabase/supabase-js | @supabase/supabase-js (Deno) |
| Embedding | voyageai (npm) | fetch API 直接呼び出し |
| Transport | Streamable HTTP (SSE) | Streamable HTTP (SSE) |

---

## ディレクトリ構成

```
dwhbi/
├── supabase/
│   └── functions/
│       ├── personal-context/
│       │   ├── index.ts              # エントリーポイント（Deno.serve）
│       │   ├── mcp/
│       │   │   ├── protocol.ts       # MCPプロトコル処理
│       │   │   ├── handler.ts        # リクエストハンドラ
│       │   │   └── types.ts          # MCP型定義
│       │   ├── auth/
│       │   │   └── validator.ts      # OAuth トークン検証
│       │   ├── rag/
│       │   │   ├── repository.ts     # Docs検索
│       │   │   ├── embedder.ts       # Voyage embedding（fetch）
│       │   │   └── tools.ts          # RAGツール定義（9ツール）
│       │   ├── supabase/             # 追加済み
│       │   │   ├── api.ts            # Management API クライアント
│       │   │   └── tools.ts          # Supabase管理ツール（16ツール）
│       │   ├── kg/                   # Phase 2: 未着手
│       │   │   ├── repository.ts     # KG操作
│       │   │   └── tools.ts          # KGツール定義
│       │   └── activity/             # Phase 2: 未着手
│       │       ├── repository.ts     # Activity検索
│       │       └── tools.ts          # Activityツール定義
│       │
│       └── _shared/
│           ├── supabase.ts           # Supabase client
│           ├── cors.ts               # CORSヘッダー
│           └── response.ts           # レスポンスユーティリティ
│
├── packages/console/                  # 既存（MCP部分は削除予定）
└── packages/analyzer/                 # 既存
```

---

## エントリーポイント

### index.ts

```typescript
// supabase/functions/personal-context/index.ts
import { corsHeaders } from "../_shared/cors.ts";
import { validateToken } from "./auth/validator.ts";
import { handleMcpRequest } from "./mcp/handler.ts";

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // OAuth Protected Resource メタデータ（GET /.well-known/...）
  const url = new URL(req.url);
  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return handleOAuthMetadata(req);
  }

  // 認証チェック
  const authResult = await validateToken(req);
  if (!authResult.valid) {
    return createUnauthorizedResponse();
  }

  // MCP処理
  try {
    return await handleMcpRequest(req, authResult.userId!);
  } catch (error) {
    console.error("MCP Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

function handleOAuthMetadata(req: Request): Response {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const metadata = {
    resource: `${baseUrl}/personal-context`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  };

  return new Response(JSON.stringify(metadata), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function createUnauthorizedResponse(): Response {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const resourceMetadataUrl = `${supabaseUrl}/functions/v1/personal-context/.well-known/oauth-protected-resource`;

  return new Response(
    JSON.stringify({ error: "Unauthorized" }),
    {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
      },
    }
  );
}
```

---

## 認証処理

### auth/validator.ts

```typescript
// supabase/functions/personal-context/auth/validator.ts
import { createClient } from "../_shared/supabase.ts";

export interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
}

export async function validateToken(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  try {
    const supabase = createClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { valid: false, error: error?.message || "Invalid token" };
    }

    return { valid: true, userId: user.id };
  } catch (error) {
    console.error("Token validation error:", error);
    return { valid: false, error: "Token validation failed" };
  }
}
```

---

## MCPプロトコル実装

### mcp/types.ts

```typescript
// supabase/functions/personal-context/mcp/types.ts

export interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: McpError;
}

export interface McpError {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, userId: string) => Promise<McpToolResult>;
}

// MCPエラーコード
export const MCP_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
```

### mcp/protocol.ts

```typescript
// supabase/functions/personal-context/mcp/protocol.ts
import { McpRequest, McpResponse, McpError, MCP_ERROR, ToolDefinition } from "./types.ts";
import { ragTools } from "../rag/tools.ts";
import { kgTools } from "../kg/tools.ts";
import { activityTools } from "../activity/tools.ts";

// 全ツールを統合
const allTools: ToolDefinition[] = [
  ...ragTools,
  ...kgTools,
  ...activityTools,
];

export async function processRequest(
  request: McpRequest,
  userId: string
): Promise<McpResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize":
        return createResponse(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "personal-context",
            version: "1.0.0",
          },
        });

      case "tools/list":
        return createResponse(id, {
          tools: allTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });

      case "tools/call":
        return await handleToolCall(id, params as { name: string; arguments: Record<string, unknown> }, userId);

      case "ping":
        return createResponse(id, {});

      default:
        return createErrorResponse(id, MCP_ERROR.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  } catch (error) {
    console.error("Protocol error:", error);
    return createErrorResponse(id, MCP_ERROR.INTERNAL_ERROR, error instanceof Error ? error.message : "Internal error");
  }
}

async function handleToolCall(
  id: string | number,
  params: { name: string; arguments: Record<string, unknown> },
  userId: string
): Promise<McpResponse> {
  const tool = allTools.find(t => t.name === params.name);

  if (!tool) {
    return createErrorResponse(id, MCP_ERROR.METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
  }

  try {
    const result = await tool.handler(params.arguments || {}, userId);
    return createResponse(id, result);
  } catch (error) {
    console.error(`Tool ${params.name} error:`, error);
    return createResponse(id, {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      }],
      isError: true,
    });
  }
}

function createResponse(id: string | number, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

function createErrorResponse(id: string | number, code: number, message: string): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
```

### mcp/handler.ts

```typescript
// supabase/functions/personal-context/mcp/handler.ts
import { corsHeaders } from "../../_shared/cors.ts";
import { processRequest } from "./protocol.ts";
import { McpRequest } from "./types.ts";

export async function handleMcpRequest(req: Request, userId: string): Promise<Response> {
  const contentType = req.headers.get("content-type") || "";

  // SSE接続の場合
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return handleSseRequest(req, userId);
  }

  // 通常のJSON-RPC
  if (contentType.includes("application/json")) {
    return handleJsonRpcRequest(req, userId);
  }

  return new Response(
    JSON.stringify({ error: "Unsupported content type" }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
}

async function handleJsonRpcRequest(req: Request, userId: string): Promise<Response> {
  const body = await req.json() as McpRequest | McpRequest[];

  // バッチリクエスト対応
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map(request => processRequest(request, userId))
    );
    return new Response(JSON.stringify(responses), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const response = await processRequest(body, userId);
  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleSseRequest(req: Request, userId: string): Promise<Response> {
  const body = await req.json() as McpRequest;

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
          error: { code: -32603, message: error instanceof Error ? error.message : "Unknown error" }
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(errorData));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

---

## RAGツール

### rag/embedder.ts

```typescript
// supabase/functions/personal-context/rag/embedder.ts

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3-lite";

export async function embedQuery(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("VOYAGE_API_KEY");
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set");
  }

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: MODEL,
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const embedding = data.data?.[0]?.embedding;

  if (!embedding) {
    throw new Error("Failed to generate embedding");
  }

  return embedding;
}
```

### rag/repository.ts

```typescript
// supabase/functions/personal-context/rag/repository.ts
import { createClient } from "../../_shared/supabase.ts";

export interface SearchResult {
  id: string;
  title: string;
  heading: string;
  content: string;
  file_path: string;
  similarity: number;
}

export interface DocumentResult {
  file_path: string;
  title: string;
  tags: string[];
  content: string;
}

export interface TagInfo {
  tag: string;
  count: number;
}

export async function searchChunks(
  queryEmbedding: number[],
  tags: string[] | null,
  limit: number,
  threshold: number
): Promise<SearchResult[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("search_chunks", {
    query_embedding: `[${queryEmbedding.join(",")}]`,
    filter_tags: tags,
    match_count: limit,
    similarity_threshold: threshold,
  });

  if (error) {
    throw new Error(`Search failed: ${error.message}`);
  }

  return data || [];
}

export async function getDocument(filePath: string): Promise<DocumentResult | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("raw")
    .from("github_contents__documents")
    .select("file_path, frontmatter, content")
    .eq("file_path", filePath)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get document: ${error.message}`);
  }

  const frontmatter = data.frontmatter as Record<string, unknown>;

  return {
    file_path: data.file_path,
    title: (frontmatter?.title as string) || "",
    tags: (frontmatter?.tags as string[]) || [],
    content: data.content,
  };
}

export async function listTags(): Promise<TagInfo[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("list_all_tags");

  if (error) {
    throw new Error(`Failed to list tags: ${error.message}`);
  }

  return data || [];
}

// 他のRAGリポジトリ関数も同様に移植...
```

### rag/tools.ts

```typescript
// supabase/functions/personal-context/rag/tools.ts
import { ToolDefinition, McpToolResult } from "../mcp/types.ts";
import { embedQuery } from "./embedder.ts";
import * as repository from "./repository.ts";

const SIMILARITY_THRESHOLD = 0;

export const ragTools: ToolDefinition[] = [
  {
    name: "search_docs",
    description: "Search personal documents using semantic similarity. Returns relevant chunks with titles and file paths.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query in natural language" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags (optional)"
        },
        limit: { type: "number", default: 5, description: "Number of results to return" },
      },
      required: ["query"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { query, tags, limit = 5 } = params as { query: string; tags?: string[]; limit?: number };

      const queryEmbedding = await embedQuery(query);
      const results = await repository.searchChunks(
        queryEmbedding,
        tags || null,
        limit,
        SIMILARITY_THRESHOLD
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No matching documents found." }],
        };
      }

      const formatted = results.map((r) => ({
        title: r.title || "(untitled)",
        heading: r.heading,
        content: r.content,
        file_path: r.file_path,
        similarity: r.similarity.toFixed(3),
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
      };
    },
  },

  {
    name: "get_doc",
    description: "Get full content of a document by file path.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Document file path" },
      },
      required: ["file_path"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { file_path } = params as { file_path: string };

      const doc = await repository.getDocument(file_path);

      if (!doc) {
        return {
          content: [{ type: "text", text: `Document not found: ${file_path}` }],
          isError: true,
        };
      }

      const tagsLine = doc.tags.length > 0 ? `Tags: ${doc.tags.join(", ")}\n\n` : "";

      return {
        content: [{
          type: "text",
          text: `# ${doc.title || "(untitled)"}\n\n${tagsLine}---\n\n${doc.content}`,
        }],
      };
    },
  },

  {
    name: "list_tags",
    description: "List all available tags with their usage count.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (_params, _userId): Promise<McpToolResult> => {
      const tags = await repository.listTags();

      if (tags.length === 0) {
        return {
          content: [{ type: "text", text: "No tags found." }],
        };
      }

      const formatted = tags.map((t) => `${t.tag} (${t.count})`).join("\n");

      return {
        content: [{ type: "text", text: formatted }],
      };
    },
  },

  // 他のRAGツール（list_docs_by_tag, list_docs_by_date, etc.）も同様に実装...
];
```

---

## KGツール

### kg/repository.ts

```typescript
// supabase/functions/personal-context/kg/repository.ts
import { createClient } from "../../_shared/supabase.ts";

export interface Entity {
  id: string;
  name: string;
  entity_type: string;
  observations: string[];
  created_at: string;
  updated_at: string;
}

export interface Relation {
  id: string;
  from_entity: string;
  to_entity: string;
  relation_type: string;
  created_at: string;
}

export async function createEntities(
  userId: string,
  entities: Array<{ name: string; entityType: string; observations: string[] }>
): Promise<Entity[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("kg_entities")
    .upsert(
      entities.map(e => ({
        name: e.name,
        entity_type: e.entityType,
        observations: e.observations,
        user_id: userId,
      })),
      { onConflict: "name,user_id" }
    )
    .select();

  if (error) {
    throw new Error(`Failed to create entities: ${error.message}`);
  }

  return data || [];
}

export async function searchEntities(
  userId: string,
  query: string
): Promise<Entity[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("kg_entities")
    .select("*")
    .eq("user_id", userId)
    .or(`name.ilike.%${query}%,entity_type.ilike.%${query}%,observations.cs.{${query}}`);

  if (error) {
    throw new Error(`Failed to search entities: ${error.message}`);
  }

  return data || [];
}

export async function readGraph(userId: string): Promise<{ entities: Entity[]; relations: Relation[] }> {
  const supabase = createClient();

  const [entitiesResult, relationsResult] = await Promise.all([
    supabase.from("kg_entities").select("*").eq("user_id", userId),
    supabase.from("kg_relations").select("*").eq("user_id", userId),
  ]);

  if (entitiesResult.error) {
    throw new Error(`Failed to read entities: ${entitiesResult.error.message}`);
  }

  if (relationsResult.error) {
    throw new Error(`Failed to read relations: ${relationsResult.error.message}`);
  }

  return {
    entities: entitiesResult.data || [],
    relations: relationsResult.data || [],
  };
}

// 他のKGリポジトリ関数...
```

### kg/tools.ts

```typescript
// supabase/functions/personal-context/kg/tools.ts
import { ToolDefinition, McpToolResult } from "../mcp/types.ts";
import * as repository from "./repository.ts";

export const kgTools: ToolDefinition[] = [
  {
    name: "kg_create_entities",
    description: "Create new entities in the knowledge graph with names, types, and observations.",
    inputSchema: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Entity name" },
              entityType: { type: "string", description: "Entity type (e.g., person, concept, place)" },
              observations: {
                type: "array",
                items: { type: "string" },
                description: "Observations about this entity",
              },
            },
            required: ["name", "entityType", "observations"],
          },
        },
      },
      required: ["entities"],
    },
    handler: async (params, userId): Promise<McpToolResult> => {
      const { entities } = params as {
        entities: Array<{ name: string; entityType: string; observations: string[] }>
      };

      const created = await repository.createEntities(userId, entities);

      return {
        content: [{
          type: "text",
          text: `Created ${created.length} entities:\n${created.map(e => `- ${e.name} (${e.entity_type})`).join("\n")}`,
        }],
      };
    },
  },

  {
    name: "kg_search",
    description: "Search entities by name, type, or observations.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    handler: async (params, userId): Promise<McpToolResult> => {
      const { query } = params as { query: string };

      const results = await repository.searchEntities(userId, query);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No matching entities found." }],
        };
      }

      const formatted = results.map(e => ({
        name: e.name,
        type: e.entity_type,
        observations: e.observations,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
      };
    },
  },

  {
    name: "kg_read_graph",
    description: "Read the entire knowledge graph (all entities and relations).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (_params, userId): Promise<McpToolResult> => {
      const graph = await repository.readGraph(userId);

      return {
        content: [{
          type: "text",
          text: JSON.stringify(graph, null, 2),
        }],
      };
    },
  },

  // 他のKGツール（kg_create_relations, kg_add_observations, kg_delete_*, kg_get_nodes）...
];
```

---

## Activityツール

### activity/repository.ts

```typescript
// supabase/functions/personal-context/activity/repository.ts
import { createClient } from "../../_shared/supabase.ts";

export interface TogglEntry {
  id: number;
  description: string;
  start: string;
  stop: string;
  duration: number;
  project_name: string | null;
  tags: string[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
}

export async function getTogglEntries(
  startDate: string,
  endDate: string,
  projectName?: string
): Promise<TogglEntry[]> {
  const supabase = createClient();

  let query = supabase
    .schema("raw")
    .from("toggl_entries")
    .select("*")
    .gte("start", startDate)
    .lte("start", endDate)
    .order("start", { ascending: false });

  if (projectName) {
    query = query.eq("project_name", projectName);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get Toggl entries: ${error.message}`);
  }

  return data || [];
}

export async function getCalendarEvents(
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("raw")
    .from("google_calendar_events")
    .select("*")
    .gte("start", startDate)
    .lte("end", endDate)
    .order("start", { ascending: true });

  if (error) {
    throw new Error(`Failed to get calendar events: ${error.message}`);
  }

  return data || [];
}

// Fitbitデータ取得関数も同様...
```

### activity/tools.ts

```typescript
// supabase/functions/personal-context/activity/tools.ts
import { ToolDefinition, McpToolResult } from "../mcp/types.ts";
import * as repository from "./repository.ts";

export const activityTools: ToolDefinition[] = [
  {
    name: "activity_get_toggl_entries",
    description: "Get Toggl time tracking entries for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO 8601)" },
        end_date: { type: "string", description: "End date (ISO 8601)" },
        project_name: { type: "string", description: "Filter by project name (optional)" },
      },
      required: ["start_date", "end_date"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { start_date, end_date, project_name } = params as {
        start_date: string;
        end_date: string;
        project_name?: string;
      };

      const entries = await repository.getTogglEntries(start_date, end_date, project_name);

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: "No Toggl entries found for the specified period." }],
        };
      }

      const formatted = entries.map(e => ({
        description: e.description || "(no description)",
        project: e.project_name || "(no project)",
        start: e.start,
        duration_minutes: Math.round(e.duration / 60),
        tags: e.tags,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
      };
    },
  },

  {
    name: "activity_get_calendar_events",
    description: "Get Google Calendar events for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO 8601)" },
        end_date: { type: "string", description: "End date (ISO 8601)" },
      },
      required: ["start_date", "end_date"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { start_date, end_date } = params as { start_date: string; end_date: string };

      const events = await repository.getCalendarEvents(start_date, end_date);

      if (events.length === 0) {
        return {
          content: [{ type: "text", text: "No calendar events found for the specified period." }],
        };
      }

      const formatted = events.map(e => ({
        summary: e.summary,
        start: e.start,
        end: e.end,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
      };
    },
  },

  // activity_get_fitbit_*, activity_summary も同様...
];
```

---

## 共有モジュール

### _shared/supabase.ts

```typescript
// supabase/functions/_shared/supabase.ts
import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  return createSupabaseClient(supabaseUrl, supabaseKey);
}
```

### _shared/cors.ts

```typescript
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
```

---

## 環境変数

### Supabase Secrets設定

```bash
# Voyage API Key を設定
supabase secrets set VOYAGE_API_KEY=your-voyage-api-key

# 確認
supabase secrets list
```

### 自動設定される環境変数

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | Supabase プロジェクトURL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key（通常は使用しない） |

---

## デプロイ

### ローカル開発

```bash
# Supabase ローカル環境起動
supabase start

# Edge Function起動（ホットリロード対応）
supabase functions serve personal-context --env-file .env.local
```

### 本番デプロイ

```bash
# デプロイ（--no-verify-jwt 必須！）
supabase functions deploy personal-context --no-verify-jwt

# ログ確認
supabase functions logs personal-context
```

> **重要**: `--no-verify-jwt` フラグが必須。このフラグがないとSupabaseがリクエストをEdge Functionに到達させる前に401を返す。カスタム認証（Supabase AuthのOAuthトークン検証）を行うため、Edge Function側で認証処理を実装している。

---

## Claude設定

### Claude カスタムコネクタ

Claudeの「My Connectors」から以下の設定で登録:

- **Name**: Personal Context
- **URL**: `https://<project-ref>.supabase.co/functions/v1/personal-context`
- **Transport**: Streamable HTTP

### claude_desktop_config.json

```json
{
  "mcpServers": {
    "personal-context": {
      "url": "https://<project-ref>.supabase.co/functions/v1/personal-context",
      "transport": "streamable-http"
    }
  }
}
```

---

## 移行チェックリスト

### Phase 1: Supabase Edge Function作成 ✅ 完了

- [x] `supabase/functions/personal-context/` 作成
- [x] エントリーポイント（index.ts）実装
- [x] 認証処理（auth/validator.ts）実装
- [x] MCPプロトコル（mcp/）実装
- [x] RAGツール移植（rag/）- 9ツール全て
- [x] 本番デプロイ（`--no-verify-jwt` フラグ必須）

### Phase 2: KG・Activity機能追加 📋 未着手

- [ ] KGテーブル作成（migration）
- [ ] KGリポジトリ・ツール実装
- [ ] Activityリポジトリ・ツール実装
- [ ] 統合テスト

### Phase 3: OAuth設定更新 ✅ 完了

- [x] Edge Function URLでOAuth動作確認
- [x] Claudeカスタムコネクタ更新
- [x] `WWW-Authenticate` ヘッダーにVercel metadata URL設定

### Phase 4: console側クリーンアップ ✅ 完了

- [x] `/api/mcp` ルート削除
- [x] `/lib/mcp/` ディレクトリ削除
- [x] MCP関連依存削除（`@modelcontextprotocol/sdk`, `voyageai`）
- [x] 認証関連は保持（`/auth/consent/`, `/.well-known/oauth-protected-resource/`）

### Supabase Management Tools ✅ 完了

- [x] `supabase/api.ts` 作成（Management APIクライアント）
- [x] `supabase/tools.ts` 作成（16ツール）
- [x] `mcp/protocol.ts` 修正（ツール登録）
- [x] `SB_MANAGEMENT_PAT` 環境変数設定（注: `SUPABASE_`プレフィックスは予約済み）
- [x] デプロイ・テスト完了

詳細は [Supabase MCP Tools 詳細設計書](./supabase-mcp-remote-design.md) を参照。

---

## 実装メモ

### アーキテクチャ（実装後）

```
Claude
  ↓ MCP Request (Bearer token)
  ↓
Supabase Edge Function (personal-context)
  ↓ 401 Unauthorized + WWW-Authenticate
  ↓
Claude → Vercel (/.well-known/oauth-protected-resource)
  ↓ authorization_servers → Supabase Auth
  ↓
Claude → Supabase Auth (OAuth)
  ↓
Vercel (/auth/consent) ← consent page
  ↓
Access Token発行
  ↓
Claude → Edge Function (with Bearer token)
  ↓
正常処理
```

### OAuthメタデータの分離

- **Vercel** (`/.well-known/oauth-protected-resource`): 認可サーバー情報を返す
- **Edge Function**: `WWW-Authenticate` ヘッダーでVercelのメタデータURLを指す

この分離により、認証フローはVercel側で完結し、MCP処理はEdge Functionで行う。

### Voyage API Key

Supabase Vaultに保存されたAPI Keyを `console.get_service_secret` RPCで取得。
環境変数ではなくVaultを使用することでセキュリティを確保。

---

## 関連ドキュメント

- [ADR-010 MCPサーバーのSupabase Edge Functions移行](./131-decisions/adr_010-mcp-server-separation.md)
- [Supabase MCP Tools 詳細設計書](./supabase-mcp-remote-design.md) ← Supabase管理ツール（16個）
- [MCP Personal Knowledge Server 詳細設計書](./mcp-personal-knowledge-design.md) ← 歴史的経緯を含む
- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
