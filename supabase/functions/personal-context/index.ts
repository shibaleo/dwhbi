import { corsHeaders } from "../_shared/cors.ts";
import { validateToken } from "./auth/validator.ts";
import { handleMcpRequest } from "./mcp/handler.ts";

Deno.serve(async (req: Request) => {
  // デバッグログ
  console.log("=== Request received ===");
  console.log("Method:", req.method);
  console.log("URL:", req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 認証チェック（Bearer トークンのみ）
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    console.log("No authentication provided");
    return createUnauthorizedResponse();
  }

  const authResult = await validateToken(req);
  if (!authResult.valid) {
    return createUnauthorizedResponse();
  }

  const userId = authResult.userId!;
  console.log("Authenticated via Bearer token:", userId);

  // MCP処理
  try {
    return await handleMcpRequest(req, userId);
  } catch (error) {
    console.error("MCP Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function createUnauthorizedResponse(): Response {
  // Resource MetadataはVercel (console)にある
  const resourceMetadataUrl = "https://dwhbi-console.vercel.app/.well-known/oauth-protected-resource";

  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    },
  });
}
