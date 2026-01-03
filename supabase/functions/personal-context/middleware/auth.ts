import { createMiddleware } from "hono/factory";
import { Context } from "hono";
import { createClient } from "@supabase/supabase-js";

// =============================================================================
// Types
// =============================================================================
type Variables = {
  userId: string;
};

// =============================================================================
// Auth Middleware
// =============================================================================
export const authMiddleware = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Bearer token check
    if (!authHeader?.startsWith("Bearer ")) {
      return createUnauthorizedResponse(c);
    }

    const token = authHeader.substring(7);

    try {
      // Service Role Key check (for testing/internal use)
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceRoleKey && token === serviceRoleKey) {
        c.set("userId", "service-role");
        return next();
      }

      // User token validation
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

      // Auth success - set userId in context
      c.set("userId", user.id);
      return next();
    } catch (error) {
      console.error("Token validation error:", error);
      return createUnauthorizedResponse(c);
    }
  }
);

// =============================================================================
// 401 Response
// =============================================================================
function createUnauthorizedResponse(c: Context): Response {
  // Resource Metadata is on Vercel (console)
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
