import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceCredentials, saveServiceCredentials } from "@/lib/vault";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function getRedirectUri() {
  // 本番URLが設定されている場合はそれを使用（最優先）
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/google_calendar/callback`;
  }
  // ローカル開発環境
  return "http://localhost:3000/api/oauth/google_calendar/callback";
}

// OAuthコールバック処理
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // エラーチェック
  if (error) {
    const errorDescription = url.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      new URL(`/services/google_calendar?error=${encodeURIComponent(errorDescription)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/services/google_calendar?error=No authorization code received", request.url)
    );
  }

  try {
    // Vaultからclient_id, client_secretを取得
    const credentials = await getServiceCredentials("google_calendar");

    if (!credentials || !credentials.client_id || !credentials.client_secret) {
      return NextResponse.redirect(
        new URL("/services/google_calendar?error=Client credentials not configured", request.url)
      );
    }

    // 認証コードをアクセストークンに交換
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: credentials.client_id as string,
        client_secret: credentials.client_secret as string,
        code,
        grant_type: "authorization_code",
        redirect_uri: getRedirectUri(),
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return NextResponse.redirect(
        new URL(`/services/google_calendar?error=${encodeURIComponent("Failed to exchange token")}`, request.url)
      );
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      return NextResponse.redirect(
        new URL("/services/google_calendar?error=No access token received", request.url)
      );
    }

    // 既存の認証情報とマージして保存
    const updatedCredentials = {
      ...credentials,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || credentials.refresh_token,
      token_type: tokenData.token_type || "Bearer",
      scope: tokenData.scope,
    };

    // expires_atを計算
    let expiresAt: string | null = null;
    if (tokenData.expires_in) {
      const expiresAtDate = new Date(Date.now() + tokenData.expires_in * 1000);
      expiresAt = expiresAtDate.toISOString();
    }

    await saveServiceCredentials("google_calendar", updatedCredentials, expiresAt);

    // 成功時はサービスページにリダイレクト
    return NextResponse.redirect(
      new URL("/services/google_calendar?success=OAuth authentication completed", request.url)
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      new URL(`/services/google_calendar?error=${encodeURIComponent("OAuth callback failed")}`, request.url)
    );
  }
}
