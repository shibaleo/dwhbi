---
title: MCP Personal Knowledge Server 詳細設計書
description: RAGベクトル検索をMCPプロトコル経由で提供するサーバーの設計
---

# MCP Personal Knowledge Server 詳細設計書

## 概要

本ドキュメントは [RAG Embedding設計](./rag-embedding.md) で定義されたMCP連携の詳細設計を記述する。

### 責務

- Claude Desktop / Claude Code からの検索リクエストを受付
- クエリテキストをVoyage AIでembedding化
- Supabase pgvectorでベクトル類似検索
- 検索結果を整形して返却

### 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| 言語 | TypeScript | MCP SDK公式サポート |
| MCP SDK | @modelcontextprotocol/server | 公式SDK |
| DB接続 | @supabase/supabase-js | 既存パターン踏襲 |
| Embedding | voyageai | クエリ用embedding生成 |
| Transport | stdio | ローカル実行 |

---

## リポジトリ構成

別リポジトリとして `mcp-personal-knowledge` を作成する。

```
mcp-personal-knowledge/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── server.ts             # MCPサーバー定義
│   ├── tools/
│   │   ├── search-docs.ts    # search_docs ツール
│   │   ├── get-doc.ts        # get_doc ツール
│   │   └── list-tags.ts      # list_tags ツール
│   ├── services/
│   │   ├── embedder.ts       # Voyage AI クライアント
│   │   └── repository.ts     # Supabase リポジトリ
│   └── config.ts             # 設定
└── dist/                     # ビルド出力
```

---

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| SUPABASE_URL | YES | Supabase プロジェクトURL |
| SUPABASE_KEY | YES | Supabase anon key または service role key |
| VOYAGE_API_KEY | YES | Voyage AI API Key |
| SIMILARITY_THRESHOLD | NO | 類似度閾値（デフォルト: 0.7） |

---

## MCP Tools 定義

### search_docs

セマンティック検索を実行し、関連するチャンクを返す。

```typescript
// src/tools/search-docs.ts
import { z } from "zod";

export const searchDocsSchema = z.object({
  query: z.string().describe("検索クエリ（自然言語）"),
  tags: z.array(z.string()).optional().describe("フィルタするタグ（オプション）"),
  limit: z.number().default(5).describe("返す結果の数"),
});

export type SearchDocsInput = z.infer<typeof searchDocsSchema>;

export interface SearchResult {
  title: string;
  heading: string;
  content: string;
  file_path: string;
  similarity: number;
}
```

**処理フロー:**

1. クエリテキストをVoyage AIでembedding化（`input_type: "query"`）
2. Supabase RPC `search_chunks` を呼び出し
3. 結果を整形して返却

### get_doc

ドキュメント全文を取得する。

```typescript
// src/tools/get-doc.ts
import { z } from "zod";

export const getDocSchema = z.object({
  file_path: z.string().describe("ドキュメントのファイルパス"),
});

export type GetDocInput = z.infer<typeof getDocSchema>;

export interface DocumentResult {
  file_path: string;
  title: string;
  tags: string[];
  content: string;
}
```

**処理フロー:**

1. `raw.docs_github` から `file_path` で検索
2. frontmatter + content を返却

### list_tags

使用されているタグ一覧を取得する。

```typescript
// src/tools/list-tags.ts
import { z } from "zod";

export const listTagsSchema = z.object({});

export type ListTagsInput = z.infer<typeof listTagsSchema>;

export interface TagInfo {
  tag: string;
  count: number;
}
```

**処理フロー:**

1. `raw.docs_github` の `frontmatter->'tags'` を集計
2. タグと使用回数を返却

---

## Supabase RPC関数

### search_chunks

ベクトル類似検索を実行する関数。

```sql
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding vector(512),
  filter_tags text[] DEFAULT NULL,
  match_count int DEFAULT 5,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  title text,
  heading text,
  parent_heading text,
  content text,
  file_path text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = rag, raw, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    d.frontmatter->>'title' AS title,
    c.heading,
    c.parent_heading,
    c.content,
    d.file_path,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM rag.chunks c
  JOIN raw.docs_github d ON c.document_id = d.id
  WHERE
    (filter_tags IS NULL OR d.frontmatter->'tags' ?| filter_tags)
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 権限付与
GRANT EXECUTE ON FUNCTION search_chunks TO anon, authenticated;
```

### list_all_tags

タグ一覧を取得する関数。

```sql
CREATE OR REPLACE FUNCTION list_all_tags()
RETURNS TABLE (
  tag text,
  count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = raw, public
AS $$
  SELECT
    tag,
    COUNT(*) as count
  FROM raw.docs_github,
    LATERAL jsonb_array_elements_text(frontmatter->'tags') AS tag
  GROUP BY tag
  ORDER BY count DESC, tag;
$$;

-- 権限付与
GRANT EXECUTE ON FUNCTION list_all_tags TO anon, authenticated;
```

---

## サービス実装

### Embedder

Voyage AIでクエリをembedding化する。

```typescript
// src/services/embedder.ts
import Anthropic from "voyageai";

export class EmbeddingService {
  private client: Anthropic;
  private model = "voyage-3-lite";

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await this.client.embed({
      input: [text],
      model: this.model,
      inputType: "query", // documentではなくquery
    });

    return response.data[0].embedding;
  }
}
```

**重要**: クエリのembedding生成時は `inputType: "query"` を指定する。ドキュメントのembedding生成時は `inputType: "document"` を使用するが、検索クエリは `query` タイプで生成する必要がある。

### Repository

Supabaseとのやり取りを行う。

```typescript
// src/services/repository.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { SearchResult } from "../tools/search-docs";
import type { DocumentResult } from "../tools/get-doc";
import type { TagInfo } from "../tools/list-tags";

export class DocsRepository {
  private supabase: SupabaseClient;

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key);
  }

  async searchChunks(
    queryEmbedding: number[],
    tags: string[] | null,
    limit: number,
    threshold: number
  ): Promise<SearchResult[]> {
    const { data, error } = await this.supabase.rpc("search_chunks", {
      query_embedding: queryEmbedding,
      filter_tags: tags,
      match_count: limit,
      similarity_threshold: threshold,
    });

    if (error) throw error;
    return data;
  }

  async getDocument(filePath: string): Promise<DocumentResult | null> {
    const { data, error } = await this.supabase
      .from("docs_github")
      .select("file_path, frontmatter, content")
      .eq("file_path", filePath)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return {
      file_path: data.file_path,
      title: data.frontmatter?.title ?? "",
      tags: data.frontmatter?.tags ?? [],
      content: data.content,
    };
  }

  async listTags(): Promise<TagInfo[]> {
    const { data, error } = await this.supabase.rpc("list_all_tags");

    if (error) throw error;
    return data;
  }
}
```

---

## MCPサーバー実装

### server.ts

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { searchDocsSchema, type SearchDocsInput } from "./tools/search-docs";
import { getDocSchema, type GetDocInput } from "./tools/get-doc";
import { listTagsSchema } from "./tools/list-tags";
import { EmbeddingService } from "./services/embedder";
import { DocsRepository } from "./services/repository";
import { loadConfig } from "./config";

export async function createServer() {
  const config = loadConfig();
  const embedder = new EmbeddingService(config.voyageApiKey);
  const repository = new DocsRepository(config.supabaseUrl, config.supabaseKey);

  const server = new McpServer({
    name: "personal-knowledge",
    version: "1.0.0",
  });

  // search_docs ツール
  server.tool(
    "search_docs",
    "個人ドキュメントをセマンティック検索する",
    searchDocsSchema,
    async (input: SearchDocsInput) => {
      // クエリをembedding化
      const queryEmbedding = await embedder.embedQuery(input.query);

      // ベクトル検索
      const results = await repository.searchChunks(
        queryEmbedding,
        input.tags ?? null,
        input.limit,
        config.similarityThreshold
      );

      // 結果を整形
      const formatted = results.map((r) => ({
        title: r.title,
        heading: r.heading,
        content: r.content,
        file_path: r.file_path,
        similarity: r.similarity.toFixed(3),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    }
  );

  // get_doc ツール
  server.tool(
    "get_doc",
    "ドキュメントの全文を取得する",
    getDocSchema,
    async (input: GetDocInput) => {
      const doc = await repository.getDocument(input.file_path);

      if (!doc) {
        return {
          content: [
            {
              type: "text",
              text: `Document not found: ${input.file_path}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `# ${doc.title}\n\nTags: ${doc.tags.join(", ")}\n\n---\n\n${doc.content}`,
          },
        ],
      };
    }
  );

  // list_tags ツール
  server.tool(
    "list_tags",
    "使用されているタグの一覧を取得する",
    listTagsSchema,
    async () => {
      const tags = await repository.listTags();

      const formatted = tags
        .map((t) => `${t.tag} (${t.count})`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: formatted,
          },
        ],
      };
    }
  );

  return server;
}
```

### index.ts

```typescript
// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error("MCP Personal Knowledge Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### config.ts

```typescript
// src/config.ts
export interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  voyageApiKey: string;
  similarityThreshold: number;
}

export function loadConfig(): Config {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required");
  }

  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseKey) {
    throw new Error("SUPABASE_KEY is required");
  }

  const voyageApiKey = process.env.VOYAGE_API_KEY;
  if (!voyageApiKey) {
    throw new Error("VOYAGE_API_KEY is required");
  }

  return {
    supabaseUrl,
    supabaseKey,
    voyageApiKey,
    similarityThreshold: parseFloat(
      process.env.SIMILARITY_THRESHOLD ?? "0.7"
    ),
  };
}
```

---

## package.json

```json
{
  "name": "mcp-personal-knowledge",
  "version": "1.0.0",
  "description": "MCP server for personal knowledge RAG search",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "mcp-personal-knowledge": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^1.9.0",
    "@supabase/supabase-js": "^2.86.0",
    "voyageai": "^0.0.3-1",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "typescript": "^5.8.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Claude Desktop 設定

### claude_desktop_config.json

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["C:/path/to/mcp-personal-knowledge/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://liegivvinbwmeujddzif.supabase.co",
        "SUPABASE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "VOYAGE_API_KEY": "pa-..."
      }
    }
  }
}
```

**設定ファイルの場所:**

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

---

## Claude Code 設定

Claude Codeでは `.claude/settings.local.json` で設定する。

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["C:/path/to/mcp-personal-knowledge/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://liegivvinbwmeujddzif.supabase.co",
        "SUPABASE_KEY": "...",
        "VOYAGE_API_KEY": "..."
      }
    }
  }
}
```

---

## 使用例

### Claude Desktopでの使用

```
User: 過去にDocker関連で書いたメモを探して

Claude: search_docs ツールを使って検索します。

[Tool call: search_docs]
{
  "query": "Docker コンテナ 設定",
  "limit": 5
}

[Results]
以下の関連ドキュメントが見つかりました：

1. **Docker Compose設定ガイド** (similarity: 0.85)
   - File: docs/tech/docker-compose-guide.md
   - 開発環境用のDocker Compose設定について...

2. **コンテナ運用のベストプラクティス** (similarity: 0.78)
   - File: docs/tech/container-best-practices.md
   - 本番環境でのコンテナ運用について...

詳細を確認しますか？
```

### タグでフィルタリング

```
User: プログラミング関連のメモからテストについて検索して

Claude: [Tool call: search_docs]
{
  "query": "テスト 単体テスト 結合テスト",
  "tags": ["programming", "testing"],
  "limit": 3
}
```

### ドキュメント全文取得

```
User: その1番目のドキュメントの全文を見せて

Claude: [Tool call: get_doc]
{
  "file_path": "docs/tech/docker-compose-guide.md"
}

# Docker Compose設定ガイド

Tags: docker, devops, infrastructure

---

## 概要

Docker Composeを使った開発環境構築について...
```

---

## エラーハンドリング

### リトライ対象

| エラー | リトライ | 対応 |
|--------|---------|------|
| Voyage API 429 (rate limit) | YES | 指数バックオフ |
| Voyage API 5xx | YES | 指数バックオフ |
| Supabase接続エラー | YES | 指数バックオフ |
| ドキュメント未検出 | NO | エラーメッセージ返却 |
| embedding生成失敗 | NO | エラーメッセージ返却 |

### エラーレスポンス

```typescript
// ツール実行時のエラー
return {
  content: [
    {
      type: "text",
      text: `Error: ${error.message}`,
    },
  ],
  isError: true,
};
```

---

## セキュリティ考慮事項

### API Key管理

- 環境変数経由で渡す（Claude Desktop/Code設定のenv）
- リポジトリにコミットしない
- anon keyを使用する場合、RLSが適用される

### RLS設定

search_chunks関数は `SECURITY DEFINER` で定義されているため、RLSをバイパスする。個人利用かつローカル実行のため許容する。

公開サーバーとして運用する場合は認証を追加する必要がある。

---

## 実装ステータス

| 項目 | 状態 |
|------|------|
| 設計完了 | - |
| Supabase RPC関数作成 | - |
| search_docs実装 | - |
| get_doc実装 | - |
| list_tags実装 | - |
| Claude Desktop設定 | - |
| テスト | - |

---

## 関連ドキュメント

- [RAG Embedding設計](./rag-embedding.md)
- [Analyzer/Embedding 詳細設計](./rag-embedding-analyzer-design.md)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

---

## Sources

- [GitHub - modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [@modelcontextprotocol/sdk - npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP Server Documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
