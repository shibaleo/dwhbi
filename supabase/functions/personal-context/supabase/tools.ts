// supabase/functions/personal-context/supabase/tools.ts
// Supabase Management API ツール定義

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
  if (!projectRef) {
    console.warn(
      "Could not extract project ref from SUPABASE_URL, Supabase management tools disabled"
    );
    return [];
  }

  const api = createManagementApi({ accessToken: pat, projectRef });

  return [
    // Database Tools
    {
      name: "sb_list_tables",
      description:
        "List all tables in the database with their schemas. Returns table names and column counts.",
      inputSchema: {
        type: "object",
        properties: {
          schemas: {
            type: "array",
            items: { type: "string" },
            description: "Schemas to include (default: ['public'])",
          },
        },
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { schemas = ["public"] } = params as { schemas?: string[] };

        const query = `
          SELECT
            schemaname as schema,
            tablename as name,
            (SELECT count(*)::int FROM information_schema.columns
             WHERE table_schema = t.schemaname AND table_name = t.tablename) as column_count
          FROM pg_tables t
          WHERE schemaname = ANY(ARRAY[${schemas.map((s) => `'${s}'`).join(",")}])
          ORDER BY schemaname, tablename
        `;

        const result = await api.executeSql(query, true);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    },

    {
      name: "sb_execute_sql",
      description:
        "Execute a SQL query against the database. Supports both read and write operations.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query to execute" },
          read_only: {
            type: "boolean",
            description: "Execute as read-only (default: true)",
          },
        },
        required: ["query"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { query, read_only = true } = params as {
          query: string;
          read_only?: boolean;
        };

        const result = await api.executeSql(query, read_only);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    },

    {
      name: "sb_list_migrations",
      description: "List all database migrations that have been applied.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const migrations = await api.listMigrations();
        return {
          content: [
            { type: "text", text: JSON.stringify(migrations, null, 2) },
          ],
        };
      },
    },

    {
      name: "sb_apply_migration",
      description:
        "Apply a new database migration. Use for DDL operations like CREATE TABLE, ALTER TABLE, etc.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Migration name in snake_case (e.g., add_users_table)",
          },
          query: { type: "string", description: "SQL DDL statements to apply" },
        },
        required: ["name", "query"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { name, query } = params as { name: string; query: string };

        await api.applyMigration(name, query);
        return {
          content: [
            {
              type: "text",
              text: `Migration "${name}" applied successfully.`,
            },
          ],
        };
      },
    },

    // Account Tools
    {
      name: "sb_list_organizations",
      description: "List all organizations you have access to.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const orgs = await api.listOrganizations();
        return {
          content: [{ type: "text", text: JSON.stringify(orgs, null, 2) }],
        };
      },
    },

    {
      name: "sb_list_projects",
      description: "List all Supabase projects you have access to.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const projects = await api.listProjects();
        return {
          content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
        };
      },
    },

    {
      name: "sb_get_project",
      description: "Get details of the current project.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const project = await api.getProject();
        return {
          content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
        };
      },
    },

    // Debugging Tools
    {
      name: "sb_get_logs",
      description:
        "Get logs for a specific service. Available services: api, postgres, edge-function, auth, storage, realtime.",
      inputSchema: {
        type: "object",
        properties: {
          service: {
            type: "string",
            enum: [
              "api",
              "postgres",
              "edge-function",
              "auth",
              "storage",
              "realtime",
            ],
            description: "Service to get logs for",
          },
          start_time: {
            type: "string",
            description: "ISO timestamp for start of log range (optional)",
          },
          end_time: {
            type: "string",
            description: "ISO timestamp for end of log range (optional)",
          },
        },
        required: ["service"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { service, start_time, end_time } = params as {
          service:
            | "api"
            | "postgres"
            | "edge-function"
            | "auth"
            | "storage"
            | "realtime";
          start_time?: string;
          end_time?: string;
        };

        const logs = await api.getLogs(service, start_time, end_time);
        return {
          content: [{ type: "text", text: JSON.stringify(logs, null, 2) }],
        };
      },
    },

    {
      name: "sb_get_security_advisors",
      description:
        "Get security recommendations and potential issues for the project.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const advisors = await api.getSecurityAdvisors();
        return {
          content: [{ type: "text", text: JSON.stringify(advisors, null, 2) }],
        };
      },
    },

    {
      name: "sb_get_performance_advisors",
      description:
        "Get performance recommendations and potential issues for the project.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const advisors = await api.getPerformanceAdvisors();
        return {
          content: [{ type: "text", text: JSON.stringify(advisors, null, 2) }],
        };
      },
    },

    // Development Tools
    {
      name: "sb_get_project_url",
      description: "Get the base URL for the current Supabase project.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const url = api.getProjectUrl();
        return {
          content: [{ type: "text", text: url }],
        };
      },
    },

    {
      name: "sb_get_api_keys",
      description:
        "Get the API keys for the project (anon key and service role key names, not values).",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const keys = await api.getApiKeys();
        return {
          content: [{ type: "text", text: JSON.stringify(keys, null, 2) }],
        };
      },
    },

    {
      name: "sb_generate_typescript_types",
      description:
        "Generate TypeScript type definitions from the database schema.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const result = await api.generateTypescriptTypes();
        return {
          content: [{ type: "text", text: result.types }],
        };
      },
    },

    // Edge Function Tools
    {
      name: "sb_list_edge_functions",
      description: "List all Edge Functions deployed in the project.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const functions = await api.listEdgeFunctions();
        return {
          content: [{ type: "text", text: JSON.stringify(functions, null, 2) }],
        };
      },
    },

    {
      name: "sb_get_edge_function",
      description: "Get details of a specific Edge Function.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The slug/name of the Edge Function",
          },
        },
        required: ["slug"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        const { slug } = params as { slug: string };
        const func = await api.getEdgeFunction(slug);
        return {
          content: [{ type: "text", text: JSON.stringify(func, null, 2) }],
        };
      },
    },

    // Storage Tools
    {
      name: "sb_list_storage_buckets",
      description: "List all storage buckets in the project.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const buckets = await api.listStorageBuckets();
        return {
          content: [{ type: "text", text: JSON.stringify(buckets, null, 2) }],
        };
      },
    },

    {
      name: "sb_get_storage_config",
      description:
        "Get storage configuration for the project including file size limits and features.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        const config = await api.getStorageConfig();
        return {
          content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
        };
      },
    },
  ];
}
