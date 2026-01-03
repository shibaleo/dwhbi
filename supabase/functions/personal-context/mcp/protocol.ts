import { McpRequest, McpResponse, MCP_ERROR, ToolDefinition } from "./types.ts";
import { ragTools } from "../tools/rag/tools.ts";
import { getSupabaseTools } from "../tools/supabase/tools.ts";
import { getNotionTools } from "../tools/notion/tools.ts";

const allTools: ToolDefinition[] = [
  ...ragTools,
  ...getSupabaseTools(),
  ...getNotionTools(),
];

export async function processRequest(
  request: McpRequest,
  userId: string
): Promise<McpResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize":
        // クライアントが要求したバージョンを確認し、サポートするバージョンを返す
        const clientVersion = (params as { protocolVersion?: string })?.protocolVersion;
        // 2024-11-05 と 2025-03-26 の両方をサポート
        const supportedVersions = ["2024-11-05", "2025-03-26"];
        const negotiatedVersion = clientVersion && supportedVersions.includes(clientVersion)
          ? clientVersion
          : "2024-11-05";

        return createResponse(id, {
          protocolVersion: negotiatedVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "personal-context", version: "1.0.0" },
        });

      case "tools/list":
        return createResponse(id, {
          tools: allTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });

      case "resources/list":
        return createResponse(id, { resources: [] });

      case "prompts/list":
        return createResponse(id, { prompts: [] });

      case "tools/call":
        return await handleToolCall(
          id,
          params as { name: string; arguments: Record<string, unknown> },
          userId
        );

      case "ping":
        return createResponse(id, {});

      case "notifications/initialized":
        // クライアントからの初期化完了通知（レスポンス不要だが空レスポンスを返す）
        return createResponse(id, {});

      default:
        return createErrorResponse(id, MCP_ERROR.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  } catch (error) {
    console.error("Protocol error:", error);
    return createErrorResponse(
      id,
      MCP_ERROR.INTERNAL_ERROR,
      error instanceof Error ? error.message : "Internal error"
    );
  }
}

async function handleToolCall(
  id: string | number,
  params: { name: string; arguments: Record<string, unknown> },
  userId: string
): Promise<McpResponse> {
  const tool = allTools.find((t) => t.name === params.name);

  if (!tool) {
    return createErrorResponse(id, MCP_ERROR.METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
  }

  try {
    const result = await tool.handler(params.arguments || {}, userId);
    return createResponse(id, result);
  } catch (error) {
    console.error(`Tool ${params.name} error:`, error);
    return createResponse(id, {
      content: [
        { type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown error"}` },
      ],
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
