/**
 * OAuth Protected Resource Metadata (RFC 9728)
 * https://modelcontextprotocol.io/specification/draft/basic/authorization
 */
import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const metadata = {
    resource: `${supabaseUrl}/functions/v1/personal-context`,
    // Claude Web fetches /.well-known/oauth-authorization-server from this URL
    // which only works at /auth/v1 level (not /auth/v1/oauth)
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
