import { corsHeaders } from "../../_shared/cors.ts";
import { processRequest } from "./protocol.ts";
import { McpRequest } from "./types.ts";

// Streamable HTTP Transport (MCP 2025-06-18) 対応
const MCP_SESSION_HEADER = "mcp-session-id";

export async function handleMcpRequest(
  req: Request,
  userId: string
): Promise<Response> {
  const contentType = req.headers.get("content-type") || "";
  const accept = req.headers.get("accept") || "";
  const sessionId = req.headers.get(MCP_SESSION_HEADER);

  // GETリクエスト: SSEストリーム開始（Streamable HTTP Transport）
  if (req.method === "GET") {
    if (accept.includes("text/event-stream")) {
      return handleSseStream(userId, sessionId);
    }
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // DELETEリクエスト: セッション終了
  if (req.method === "DELETE") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // POSTリクエスト: JSON-RPC処理
  if (req.method === "POST") {
    // SSEレスポンスを期待する場合
    if (accept.includes("text/event-stream")) {
      return handleSseRequest(req, userId, sessionId);
    }

    // 通常のJSON-RPC
    if (contentType.includes("application/json")) {
      return handleJsonRpcRequest(req, userId, sessionId);
    }
  }

  return new Response(JSON.stringify({ error: "Unsupported content type" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleJsonRpcRequest(
  req: Request,
  userId: string,
  sessionId: string | null
): Promise<Response> {
  const body = (await req.json()) as McpRequest | McpRequest[];

  // レスポンスヘッダー
  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
  };

  // セッションIDを返す（Streamable HTTP Transport）
  if (sessionId) {
    responseHeaders[MCP_SESSION_HEADER] = sessionId;
  }

  // バッチリクエスト対応
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((request) => processRequest(request, userId))
    );
    return new Response(JSON.stringify(responses), {
      headers: responseHeaders,
    });
  }

  // 通知（idなし）の場合は202 Accepted
  if (!body.id) {
    await processRequest(body, userId);
    return new Response(null, {
      status: 202,
      headers: responseHeaders,
    });
  }

  const response = await processRequest(body, userId);
  return new Response(JSON.stringify(response), {
    headers: responseHeaders,
  });
}

async function handleSseRequest(
  req: Request,
  userId: string,
  sessionId: string | null
): Promise<Response> {
  const body = (await req.json()) as McpRequest;

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

  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  if (sessionId) {
    responseHeaders[MCP_SESSION_HEADER] = sessionId;
  }

  return new Response(stream, {
    headers: responseHeaders,
  });
}

// GETリクエスト用のSSEストリーム（サーバーからの非同期通知用）
function handleSseStream(
  _userId: string,
  sessionId: string | null
): Response {
  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  if (sessionId) {
    responseHeaders[MCP_SESSION_HEADER] = sessionId;
  }

  // 空のストリームを返す（サーバーからの非同期通知が必要な場合に使用）
  const stream = new ReadableStream({
    start(controller) {
      // Keep-aliveのためのコメント送信
      const keepAlive = `: keep-alive\n\n`;
      controller.enqueue(new TextEncoder().encode(keepAlive));
    },
  });

  return new Response(stream, {
    headers: responseHeaders,
  });
}
