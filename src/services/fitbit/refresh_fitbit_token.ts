// refresh_fitbit_token.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface FitbitTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user_fitbit_id: string;
}

interface FitbitRefreshResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  user_id: string;
}

async function refreshFitbitToken(): Promise<FitbitTokenData> {
  // 環境変数の取得
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("FITBIT_CLIENT_ID");
  const clientSecret = Deno.env.get("FITBIT_CLIENT_SECRET");

  if (!supabaseUrl || !supabaseKey || !clientId || !clientSecret) {
    throw new Error("Required environment variables are missing");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 現在のトークンを取得
  const { data: currentToken, error: fetchError } = await supabase
    .from("fitbit_tokens")
    .select("*")
    .single();

  if (fetchError || !currentToken) {
    throw new Error("Failed to fetch current token from database");
  }

  console.log("📌 Current token expires at:", currentToken.expires_at);

  // トークンの有効期限を確認
  const expiresAt = new Date(currentToken.expires_at);
  const now = new Date();
  const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilExpiry > 1) {
    console.log(`✅ Token is still valid for ${hoursUntilExpiry.toFixed(1)} hours`);
    console.log("   No refresh needed");
    return currentToken;
  }

  console.log("🔄 Refreshing token...");

  // Fitbit APIでトークンをリフレッシュ
  const authHeader = btoa(`${clientId}:${clientSecret}`);
  
  const response = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentToken.refresh_token,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fitbit API error: ${response.status} ${errorText}`);
  }

  const newToken: FitbitRefreshResponse = await response.json();

  // 新しいトークンをデータベースに保存
  const newExpiresAt = new Date(Date.now() + newToken.expires_in * 1000);

  const { error: updateError } = await supabase
    .from("fitbit_tokens")
    .update({
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
      expires_at: newExpiresAt.toISOString(),
      scope: newToken.scope,
      last_refreshed_at: new Date().toISOString(),
      metadata: {
        ...currentToken.metadata,
        last_refresh_reason: hoursUntilExpiry < 0 ? "expired" : "proactive",
        refresh_count: (currentToken.metadata?.refresh_count || 0) + 1,
      },
    })
    .eq("id", currentToken.id);

  if (updateError) {
    throw new Error(`Failed to update token: ${updateError.message}`);
  }

  console.log("✅ Token refreshed successfully");
  console.log(`   New expiry: ${newExpiresAt.toISOString()}`);
  console.log(`   Valid for: ${(newToken.expires_in / 3600).toFixed(1)} hours`);

  return {
    access_token: newToken.access_token,
    refresh_token: newToken.refresh_token,
    expires_at: newExpiresAt.toISOString(),
    user_fitbit_id: newToken.user_id,
  };
}

// メイン実行
if (import.meta.main) {
  try {
    await refreshFitbitToken();
  } catch (error) {
    console.error("❌ Error:", error.message);
    Deno.exit(1);
  }
}

// エクスポート（他のスクリプトから使用可能）
export { refreshFitbitToken };
export type { FitbitTokenData };