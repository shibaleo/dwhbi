import { corsHeaders } from "../_shared/cors.ts";
import { validateToken } from "./auth/validator.ts";
import { handleMcpRequest } from "./mcp/handler.ts";

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // OAuth Protected Resource メタデータ（認証不要）
  if (url.pathname.includes("/.well-known/oauth-protected-resource")) {
    return handleOAuthMetadata();
  }

  // 認証チェック
  const authResult = await validateToken(req);
  if (!authResult.valid) {
    return createUnauthorizedResponse();
  }

  // MCP処理
  try {
    return await handleMcpRequest(req, authResult.userId!);
  } catch (error) {
    console.error("MCP Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function handleOAuthMetadata(): Response {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const metadata = {
    resource: `${supabaseUrl}/functions/v1/personal-context`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  };

  return new Response(JSON.stringify(metadata), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
