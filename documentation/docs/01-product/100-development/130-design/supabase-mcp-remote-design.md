---
title: Supabase MCP Tools 詳細設計書
description: Supabase公式MCPのツールをpersonal-context Edge Functionに統合するための設計
status: 実装完了
---

# Supabase MCP Tools 詳細設計書

## 概要

本ドキュメントは、Supabase公式MCPサーバーの機能を既存のpersonal-context Edge Functionに統合するための詳細設計を記述する。

### 背景

- Supabase公式MCPはローカル実行（stdio）またはホスト型（mcp.supabase.com）として提供
- 個人利用でリモートMCPとしてClaude等から接続したい
- 公式MCPのソースコード（Apache 2.0）を参考に、必要な機能をEdge Functionに移植

### 目的

1. **リモートアクセス**: Claude Desktop/Code/claude.aiからリモートMCPとして接続
2. **機能統合**: 既存のpersonal-context MCPにツールを追加（単一エンドポイント）
3. **開発支援**: DB操作、マイグレーション、Edge Function管理等をAIアシスタント経由で実行

### 設計方針

| 項目 | 方針 |
|------|------|
| **統合先** | personal-context Edge Function（新規Edge Functionは作成しない） |
| **認証** | 既存のOAuth 2.1 + Consent Screen認証を共有 |
| **API呼び出し** | Supabase Management API (REST) をfetchで呼び出し |
| **PAT管理** | 環境変数 `SB_MANAGEMENT_PAT` として設定（`SUPABASE_`プレフィックスは予約済みのため使用不可） |

### メリット

- OAuth認証基盤を共有（2つ管理する必要なし）
- 単一エンドポイントで全ツールにアクセス
- mcp/の重複なし
- デプロイ・運用がシンプル

---

## アーキテクチャ

### 公式MCPの構造（参考）

```
supabase-community/supabase-mcp
├── packages/mcp-server-supabase/src/
│   ├── platform/
│   │   └── api-platform.ts     # Management API呼び出し
│   ├── tools/
│   │   ├── account-tools.ts    # プロジェクト・組織管理
│   │   ├── database-operation-tools.ts  # SQL実行、マイグレーション
│   │   ├── debugging-tools.ts  # ログ、アドバイザー
│   │   ├── development-tools.ts # URL、APIキー、型生成
│   │   ├── edge-function-tools.ts # Edge Function管理
│   │   ├── storage-tools.ts    # Storage設定
│   │   └── branching-tools.ts  # ブランチ管理
│   └── management-api/
│       └── index.ts            # openapi-fetch クライアント
```

### 統合後の構造

```
dwhbi/supabase/functions/
├── personal-context/                 # 既存 + 拡張
│   ├── index.ts                      # エントリーポイント（変更なし）
│   ├── mcp/
│   │   ├── protocol.ts               # ツール登録を追加
│   │   ├── handler.ts
│   │   └── types.ts
│   ├── auth/
│   │   └── validator.ts              # 既存（変更なし）
│   ├── rag/                          # 既存
│   │   ├── repository.ts
│   │   ├── embedder.ts
│   │   └── tools.ts
│   └── supabase/                     # 新規追加
│       ├── api.ts                    # Management API クライアント
│       └── tools.ts                  # Supabase管理ツール
│
└── _shared/
    ├── supabase.ts
    └── cors.ts
```

---

## 環境変数

### 追加設定

| 変数名 | 説明 | 取得方法 |
|--------|------|----------|
| `SB_MANAGEMENT_PAT` | Personal Access Token | Supabase Dashboard → Account → Access Tokens |

### 設定コマンド

```bash
# PAT設定（personal-contextに追加）
# 注意: SUPABASE_で始まる名前は予約されているため使用不可
supabase secrets set SB_MANAGEMENT_PAT=sbp_xxxxxxxxxxxxxxxxxxxxxxxx
```

### 既存の環境変数（自動設定）

- `SUPABASE_URL`: プロジェクトURL（project_refを含む）
- `SUPABASE_ANON_KEY`: anon key
- `SUPABASE_SERVICE_ROLE_KEY`: service role key

> **Note**: `SUPABASE_PROJECT_REF`は`SUPABASE_URL`から抽出可能なため、別途設定不要。

---

## Management API クライアント

### supabase/api.ts

```typescript
// supabase/functions/personal-context/supabase/api.ts

const MANAGEMENT_API_URL = "https://api.supabase.com";

interface ManagementApiOptions {
  accessToken: string;
  projectRef?: string;
}

export function createManagementApi(options: ManagementApiOptions) {
  const { accessToken, projectRef } = options;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${MANAGEMENT_API_URL}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `API error: ${response.status}`);
    }

    return response.json();
  }

  return {
    // Database Operations
    async executeSql(query: string, readOnly = false) {
      return request<unknown[]>("POST", `/v1/projects/${projectRef}/database/query`, {
        query,
        read_only: readOnly,
      });
    },

    async listMigrations() {
      return request<Migration[]>("GET", `/v1/projects/${projectRef}/database/migrations`);
    },

    async applyMigration(name: string, query: string) {
      return request<void>("POST", `/v1/projects/${projectRef}/database/migrations`, {
        name,
        query,
      });
    },

    // Account Operations
    async listOrganizations() {
      return request<Organization[]>("GET", "/v1/organizations");
    },

    async listProjects() {
      return request<Project[]>("GET", "/v1/projects");
    },

    async getProject(ref?: string) {
      return request<Project>("GET", `/v1/projects/${ref || projectRef}`);
    },

    // Debugging Operations
    async getLogs(service: LogService, startTime?: string, endTime?: string) {
      const sql = getLogQuery(service);
      const params = new URLSearchParams({ sql });
      if (startTime) params.set("iso_timestamp_start", startTime);
      if (endTime) params.set("iso_timestamp_end", endTime);

      return request<unknown>("GET",
        `/v1/projects/${projectRef}/analytics/endpoints/logs.all?${params}`
      );
    },

    async getSecurityAdvisors() {
      return request<unknown>("GET", `/v1/projects/${projectRef}/advisors/security`);
    },

    async getPerformanceAdvisors() {
      return request<unknown>("GET", `/v1/projects/${projectRef}/advisors/performance`);
    },

    // Development Operations
    async getProjectUrl() {
      return `https://${projectRef}.supabase.co`;
    },

    async getPublishableKeys() {
      return request<ApiKey[]>("GET", `/v1/projects/${projectRef}/api-keys?reveal=false`);
    },

    async generateTypescriptTypes() {
      return request<{ types: string }>("GET", `/v1/projects/${projectRef}/types/typescript`);
    },

    // Edge Functions
    async listEdgeFunctions() {
      return request<EdgeFunction[]>("GET", `/v1/projects/${projectRef}/functions`);
    },

    async getEdgeFunction(slug: string) {
      return request<EdgeFunction>("GET", `/v1/projects/${projectRef}/functions/${slug}`);
    },

    // Storage
    async listStorageBuckets() {
      return request<StorageBucket[]>("GET", `/v1/projects/${projectRef}/storage/buckets`);
    },

    async getStorageConfig() {
      return request<StorageConfig>("GET", `/v1/projects/${projectRef}/config/storage`);
    },
  };
}

// Types
interface Migration {
  version: string;
  name?: string;
}

interface Organization {
  id: string;
  name: string;
}

interface Project {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  region: string;
  created_at: string;
}

interface ApiKey {
  api_key: string;
  name: string;
  type: "legacy" | "publishable";
}

interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  status: string;
  version: number;
}

interface StorageBucket {
  id: string;
  name: string;
  public: boolean;
}

interface StorageConfig {
  fileSizeLimit: number;
  features: {
    imageTransformation: { enabled: boolean };
    s3Protocol: { enabled: boolean };
  };
}

type LogService = "api" | "postgres" | "edge-function" | "auth" | "storage" | "realtime";

function getLogQuery(service: LogService): string {
  // 公式MCPのlogs.tsから移植
  const queries: Record<LogService, string> = {
    api: `select timestamp, event_message from edge_logs...`,
    postgres: `select timestamp, event_message from postgres_logs...`,
    // ... 省略
  };
  return queries[service] || queries.api;
}
```

---

## ツール定義

### supabase/tools.ts

```typescript
// supabase/functions/personal-context/supabase/tools.ts
import { ToolDefinition, McpToolResult } from "../mcp/types.ts";
import { createManagementApi } from "./api.ts";

// 環境変数からproject_refを抽出
function getProjectRef(): string {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] || "";
}

export function getSupabaseTools(): ToolDefinition[] {
  const pat = Deno.env.get("SB_MANAGEMENT_PAT");
  if (!pat) {
    console.warn("SB_MANAGEMENT_PAT not set, Supabase management tools disabled");
    return [];
  }

  const projectRef = getProjectRef();
  const api = createManagementApi({ accessToken: pat, projectRef });

  return [
    {
      name: "list_tables",
      description: "List all tables in the database with their columns and relationships.",
      inputSchema: {
        type: "object",
        properties: {
          schemas: {
            type: "array",
            items: { type: "string" },
            default: ["public"],
            description: "Schemas to include",
          },
        },
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { schemas = ["public"] } = params as { schemas?: string[] };

        // pg_catalog からテーブル情報を取得するSQL
        const query = `
          SELECT
            schemaname as schema,
            tablename as name,
            (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = schemaname AND table_name = tablename) as column_count
          FROM pg_tables
          WHERE schemaname = ANY($1)
          ORDER BY schemaname, tablename
        `;

        const result = await api.executeSql(query, true);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },

    {
      name: "execute_sql",
      description: "Execute a SQL query against the database. Use for SELECT queries and data analysis.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query to execute" },
          read_only: { type: "boolean", default: true, description: "Execute as read-only" },
        },
        required: ["query"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { query, read_only = true } = params as { query: string; read_only?: boolean };

        const result = await api.executeSql(query, read_only);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },

    {
      name: "list_migrations",
      description: "List all database migrations.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const migrations = await api.listMigrations();
        return { content: [{ type: "text", text: JSON.stringify(migrations, null, 2) }] };
      },
    },

    {
      name: "apply_migration",
      description: "Apply a new database migration (DDL operations).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Migration name in snake_case" },
          query: { type: "string", description: "SQL DDL to apply" },
        },
        required: ["name", "query"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { name, query } = params as { name: string; query: string };

        await api.applyMigration(name, query);
        return { content: [{ type: "text", text: `Migration "${name}" applied successfully.` }] };
      },
    },
  ];
}
```

ツールは1ファイルに統合し、全ツールを配列として返す。詳細な実装は上記の`supabase/tools.ts`を参照。

---

## 既存コードへの変更

### mcp/protocol.ts（変更箇所）

```typescript
// supabase/functions/personal-context/mcp/protocol.ts
import { McpRequest, McpResponse, MCP_ERROR, ToolDefinition } from "./types.ts";
import { ragTools } from "../rag/tools.ts";
import { getSupabaseTools } from "../supabase/tools.ts";  // 追加

const allTools: ToolDefinition[] = [
  ...ragTools,
  ...getSupabaseTools(),  // 追加
];

// 以下は既存のまま変更なし
export async function processRequest(
  request: McpRequest,
  userId: string
): Promise<McpResponse> {
  // ...
}
```

> **Note**: index.ts, auth/validator.ts, mcp/handler.ts は変更不要。ツールを追加するだけで認証・プロトコル処理は既存のものを利用。

---

## ツール一覧

### 移植対象ツール

| カテゴリ | ツール名 | 説明 | 優先度 |
|----------|----------|------|--------|
| **Database** | `list_tables` | テーブル一覧取得 | HIGH |
| | `execute_sql` | SQL実行（SELECT等） | HIGH |
| | `list_migrations` | マイグレーション一覧 | MEDIUM |
| | `apply_migration` | マイグレーション適用 | MEDIUM |
| **Account** | `list_organizations` | 組織一覧 | LOW |
| | `list_projects` | プロジェクト一覧 | LOW |
| | `get_project` | プロジェクト詳細 | MEDIUM |
| **Debugging** | `get_logs` | ログ取得 | HIGH |
| | `get_security_advisors` | セキュリティ診断 | MEDIUM |
| | `get_performance_advisors` | パフォーマンス診断 | MEDIUM |
| **Development** | `get_project_url` | プロジェクトURL | LOW |
| | `get_publishable_keys` | APIキー取得 | MEDIUM |
| | `generate_typescript_types` | 型定義生成 | HIGH |
| **Edge Functions** | `list_edge_functions` | 関数一覧 | MEDIUM |
| | `get_edge_function` | 関数詳細 | MEDIUM |
| **Storage** | `list_storage_buckets` | バケット一覧 | LOW |
| | `get_storage_config` | Storage設定 | LOW |

### 除外ツール（リスク考慮）

| ツール名 | 除外理由 |
|----------|----------|
| `create_project` | 課金影響 |
| `pause_project` | サービス停止 |
| `restore_project` | 課金影響 |
| `deploy_edge_function` | デプロイリスク |
| `delete_branch` | データ損失リスク |

---

## デプロイ

### 環境変数設定

```bash
# PAT設定（既存のpersonal-contextに追加）
# 注意: SUPABASE_で始まる名前は予約されているため使用不可
supabase secrets set SB_MANAGEMENT_PAT=sbp_xxxxxxxxxxxxxxxxxxxxxxxx
```

### デプロイコマンド

```bash
# personal-contextを再デプロイ（supabase/ディレクトリ追加後）
supabase functions deploy personal-context --no-verify-jwt

# ログ確認
supabase functions logs personal-context
```

### Claude設定

既存のpersonal-context設定をそのまま使用。追加設定不要。

#### Claude Code (VSCode拡張)

プロジェクトルートに`.mcp.json`を配置:

```json
{
  "mcpServers": {
    "personal-context": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/personal-context?token=${MCP_API_KEY}"
    }
  }
}
```

> **既知の問題（2026-01時点）**: Claude Code VSCode拡張（v2.0.74）では、`.mcp.json`の`headers`フィールドが正しく送信されない問題が確認されている。
>
> **回避策**: クエリパラメータでAPIキーを渡す方式を採用。
>
> **設定手順**:
> 1. Supabase Secretsに`MCP_API_KEY`を設定: `supabase secrets set MCP_API_KEY=<random-key>`
> 2. ローカル環境変数に`MCP_API_KEY`を設定（`.mcp.json`の`${MCP_API_KEY}`が展開される）
> 3. Edge Functionはクエリパラメータの`token`と環境変数`MCP_API_KEY`を比較して認証

#### Claude Desktop / claude.ai

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

## セキュリティ考慮事項

### 認証

- 既存のOAuth 2.1 + Consent Screen認証を使用
- Supabase Auth経由でユーザー認証
- `--no-verify-jwt`でデプロイするが、Edge Function内でトークン検証を実施

### PAT管理

- PATは環境変数としてSupabase Secretsに保存
- PATはManagement API呼び出し専用（ユーザー認証とは別）
- 定期的なローテーションを推奨

### 破壊的操作

本設計では以下の破壊的操作を含むが、個人利用のため許容：

| ツール | リスク | 備考 |
|--------|--------|------|
| `execute_sql` | 任意SQL実行 | read_only=falseでDML/DDL可能 |
| `apply_migration` | 本番DDL適用 | 直接適用可能 |

---

## 実装ステータス

| 項目 | 状態 |
|------|------|
| 設計完了 | ✅ |
| supabase/api.ts | ✅ 完了 |
| supabase/tools.ts | ✅ 完了 |
| mcp/protocol.ts 修正 | ✅ 完了 |
| PAT環境変数設定 | ✅ 完了 (`SB_MANAGEMENT_PAT`) |
| デプロイ・テスト | ✅ 完了 (全16ツール動作確認済み) |

---

## 関連ドキュメント

- [Personal Context Edge Function 詳細設計書](./personal-context-edge-function-design.md)
- [Supabase MCP Server (公式)](https://github.com/supabase-community/supabase-mcp)
- [Supabase Management API](https://supabase.com/docs/reference/api/introduction)

---

## Sources

- [GitHub - supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp)
- [Supabase Management API Documentation](https://supabase.com/docs/reference/api/introduction)
- [Deploy MCP servers on Edge Functions](https://supabase.com/docs/guides/getting-started/byo-mcp)
