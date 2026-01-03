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
