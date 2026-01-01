import { McpRequest, McpResponse, MCP_ERROR, ToolDefinition } from "./types.ts";
import { ragTools } from "../rag/tools.ts";

const allTools: ToolDefinition[] = [...ragTools];

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

      case "tools/call":
        return await handleToolCall(
          id,
          params as { name: string; arguments: Record<string, unknown> },
          userId
        );

      case "ping":
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
