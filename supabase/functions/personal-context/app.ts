import { Hono } from "hono";
import { cors } from "hono/cors";
import { Context } from "hono";
import { authMiddleware } from "./middleware/auth.ts";
import { processRequest } from "./mcp/protocol.ts";
import { McpRequest } from "./mcp/types.ts";

export const app = new Hono();

// Streamable HTTP Transport (MCP 2025-06-18)
const MCP_SESSION_HEADER = "mcp-session-id";

// =============================================================================
// CORS
// =============================================================================
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

// =============================================================================
// OAuth Protected Resource metadata (no auth required)
// =============================================================================
app.get("/.well-known/oauth-protected-resource", (c) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  return c.json({
    resource: `${supabaseUrl}/functions/v1/personal-context`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  });
});

app.get("*/.well-known/oauth-protected-resource", (c) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  return c.json({
    resource: `${supabaseUrl}/functions/v1/personal-context`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  });
});

// =============================================================================
// Auth middleware (applied to all routes below)
// =============================================================================
app.use("*", authMiddleware);

// =============================================================================
// MCP endpoints
// =============================================================================
app.post("/", handleMcpRequest);
app.get("/", handleMcpRequest);
app.delete("/", handleMcpRequest);

// =============================================================================
// MCP Request Handler
// =============================================================================
async function handleMcpRequest(c: Context): Promise<Response> {
  const req = c.req.raw;
  const userId = c.get("userId") as string;

  const contentType = c.req.header("content-type") || "";
  const accept = c.req.header("accept") || "";
  const sessionId = c.req.header(MCP_SESSION_HEADER);

  // GET: SSE stream (Streamable HTTP Transport)
  if (req.method === "GET") {
    if (accept.includes("text/event-stream")) {
      return handleSseStream(sessionId);
    }
    return c.json({ error: "Method not allowed" }, 405);
  }

  // DELETE: Session termination
  if (req.method === "DELETE") {
    return new Response(null, { status: 204 });
  }

  // POST: JSON-RPC
  if (req.method === "POST") {
    if (accept.includes("text/event-stream")) {
      return handleSseRequest(c, userId, sessionId);
    }

    if (contentType.includes("application/json")) {
      return handleJsonRpcRequest(c, userId, sessionId);
    }
  }

  return c.json({ error: "Unsupported content type" }, 400);
}

// =============================================================================
// JSON-RPC Request
// =============================================================================
async function handleJsonRpcRequest(
  c: Context,
  userId: string,
  sessionId: string | null
): Promise<Response> {
  const body = (await c.req.json()) as McpRequest | McpRequest[];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (sessionId) {
    headers[MCP_SESSION_HEADER] = sessionId;
  }

  // Batch request
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((request) => processRequest(request, userId))
    );
    return c.json(responses, 200, headers);
  }

  // Notification (no id) - 202 Accepted
  if (!body.id) {
    await processRequest(body, userId);
    return new Response(null, { status: 202, headers });
  }

  const response = await processRequest(body, userId);
  return c.json(response, 200, headers);
}

// =============================================================================
// SSE Request (POST with Accept: text/event-stream)
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
// SSE Stream (GET request)
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

  const stream = new ReadableStream({
    start(controller) {
      const keepAlive = `: keep-alive\n\n`;
      controller.enqueue(new TextEncoder().encode(keepAlive));
    },
  });

  return new Response(stream, { headers });
}

// =============================================================================
// Supabase Edge Function routing
// =============================================================================
const rootApp = new Hono();
rootApp.route("/personal-context", app);
rootApp.route("/", app);

export { rootApp };
