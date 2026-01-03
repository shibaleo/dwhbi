import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.ts";
import { handleMcpRequest } from "./handler.ts";

export const app = new Hono();

// =============================================================================
// CORS ミドルウェア
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
// OAuth Protected Resource メタデータ（認証不要）
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

// パスに関係なく .well-known をキャッチ（互換性）
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
// 認証ミドルウェア（以降のルートに適用）
// =============================================================================
app.use("*", authMiddleware);

// =============================================================================
// MCP エンドポイント
// =============================================================================
app.post("/", (c) => handleMcpRequest(c));
app.get("/", (c) => handleMcpRequest(c));
app.delete("/", (c) => handleMcpRequest(c));

// =============================================================================
// Supabase Edge Function ルーティング対応
// =============================================================================
const rootApp = new Hono();
rootApp.route("/personal-context", app);
rootApp.route("/", app);

export { rootApp };
