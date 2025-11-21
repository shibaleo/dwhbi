// save_fitbit_token.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface FitbitTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  user_id: string;
}

async function saveFitbitToken(tokenResponse: FitbitTokenResponse) {
  // Supabase接続
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // expires_atを計算
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

  // トークンデータを準備
  const tokenData = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    token_type: tokenResponse.token_type,
    expires_at: expiresAt.toISOString(),
    scope: tokenResponse.scope,
    user_fitbit_id: tokenResponse.user_id,
    last_refreshed_at: new Date().toISOString(),
    metadata: {
      initial_token: true,
      scopes: tokenResponse.scope.split(" "),
    },
  };

  // 既存のトークンを取得
  const { data: existing } = await supabase
    .from("fitbit_tokens")
    .select("id")
    .limit(1)
    .single();

  let result;
  if (existing) {
    // 更新
    result = await supabase
      .from("fitbit_tokens")
      .update(tokenData)
      .eq("id", existing.id);
  } else {
    // 新規作成
    result = await supabase
      .from("fitbit_tokens")
      .insert(tokenData);
  }

  if (result.error) {
    throw new Error(`Failed to save token: ${result.error.message}`);
  }

  console.log("✅ Fitbit token saved successfully");
  console.log(`   User ID: ${tokenResponse.user_id}`);
  console.log(`   Expires at: ${expiresAt.toISOString()}`);
  console.log(`   Scopes: ${tokenResponse.scope.split(" ").length} permissions`);
}

// メイン実行
if (import.meta.main) {
  const tokenJson = Deno.args[0];

  if (!tokenJson) {
    console.error("Usage: deno run --allow-net --allow-env save_fitbit_token.ts '<json>'");
    console.error('Example: deno run --allow-net --allow-env save_fitbit_token.ts \'{"access_token":"..."}\'');
    Deno.exit(1);
  }

  try {
    const tokenResponse: FitbitTokenResponse = JSON.parse(tokenJson);
    await saveFitbitToken(tokenResponse);
  } catch (error) {
    console.error("❌ Error:", error.message);
    Deno.exit(1);
  }
}