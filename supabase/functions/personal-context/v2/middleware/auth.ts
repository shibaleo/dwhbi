import { createMiddleware } from "hono/factory";
import { Context } from "hono";
import { createClient } from "@supabase/supabase-js";

// =============================================================================
// 型定義
// =============================================================================
type Variables = {
  userId: string;
};

// =============================================================================
// 認証ミドルウェア
// =============================================================================
export const authMiddleware = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Bearerトークンチェック
    if (!authHeader?.startsWith("Bearer ")) {
      return createUnauthorizedResponse(c);
    }

    const token = authHeader.substring(7);

    try {
      // Service Role Key チェック（テスト/内部用）
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceRoleKey && token === serviceRoleKey) {
        c.set("userId", "service-role");
        return next();
      }

      // ユーザートークン検証
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        console.error("Token validation failed:", error?.message);
        return createUnauthorizedResponse(c);
      }

      // 認証成功 - userIdをコンテキストにセット
      c.set("userId", user.id);
      return next();
    } catch (error) {
      console.error("Token validation error:", error);
      return createUnauthorizedResponse(c);
    }
  }
);

// =============================================================================
// 401レスポンス生成
// =============================================================================
function createUnauthorizedResponse(c: Context): Response {
  // Resource MetadataはVercel (console)にある
  const resourceMetadataUrl =
    "https://dwhbi-console.vercel.app/.well-known/oauth-protected-resource";

  return c.json(
    { error: "Unauthorized" },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    }
  );
}
