import { corsHeaders } from "../../_shared/cors.ts";
import { processRequest } from "./protocol.ts";
import { McpRequest } from "./types.ts";

export async function handleMcpRequest(
  req: Request,
  userId: string
): Promise<Response> {
  const contentType = req.headers.get("content-type") || "";

  // SSE接続の場合
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return handleSseRequest(req, userId);
  }

  // 通常のJSON-RPC
  if (contentType.includes("application/json")) {
    return handleJsonRpcRequest(req, userId);
  }

  return new Response(JSON.stringify({ error: "Unsupported content type" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleJsonRpcRequest(
  req: Request,
  userId: string
): Promise<Response> {
  const body = (await req.json()) as McpRequest | McpRequest[];

  // バッチリクエスト対応
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((request) => processRequest(request, userId))
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

async function handleSseRequest(
  req: Request,
  userId: string
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

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
