/**
 * OAuth Protected Resource Metadata (RFC 9728)
 * https://modelcontextprotocol.io/specification/draft/basic/authorization
 */
import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dwhbi-console.vercel.app";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const metadata = {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
  };

  return NextResponse.json(metadata, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
