import { createClient } from "../../_shared/supabase.ts";
import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
}

export async function validateToken(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.substring(7);

  try {
    // Service role keyの場合は特別に許可（テスト/内部用）
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceRoleKey && token === serviceRoleKey) {
      return { valid: true, userId: "service-role" };
    }

    // 通常のユーザートークン検証
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { valid: false, error: error?.message || "Invalid token" };
    }

    return { valid: true, userId: user.id };
  } catch (error) {
    console.error("Token validation error:", error);
    return { valid: false, error: "Token validation failed" };
  }
}
