import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceCredentials } from "@/lib/vault";

// Google OAuth2 設定
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// calendar scope includes read/write access to events
const SCOPES = "https://www.googleapis.com/auth/calendar";

function getRedirectUri(request?: Request) {
  // Vercel環境ではVERCEL_URLを使用、なければリクエストURLから取得
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/oauth/google_calendar/callback`;
  }
  // 本番URLが設定されている場合はそれを使用
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/google_calendar/callback`;
  }
  // ローカル開発環境
  return "http://localhost:3000/api/oauth/google_calendar/callback";
}

// OAuth認証開始 - 認証URLを返す
export async function GET() {
  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Vaultからclient_idを取得
    const credentials = await getServiceCredentials("google_calendar");

    if (!credentials || !credentials.client_id) {
      return NextResponse.json(
        { error: "Client ID not configured. Please save Client ID first." },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      client_id: credentials.client_id as string,
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("Failed to generate auth URL:", error);
    return NextResponse.json(
      { error: "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}
