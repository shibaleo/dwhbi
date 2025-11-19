// tanita_refresh_and_save.ts
// SupabaseからTanitaトークンを取得→リフレッシュ→再保存
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// 環境変数取得
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const clientId = Deno.env.get("TANITA_CLIENT_ID");
const clientSecret = Deno.env.get("TANITA_CLIENT_SECRET");
const redirectUri = "https://www.healthplanet.jp/success.html"; // Tanita固定のredirect_uri

if (!supabaseUrl || !supabaseKey || !clientId || !clientSecret) {
  console.error("❌ 必要な環境変数が設定されていません");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 1. Supabaseから現在のトークンを取得
console.log("📥 Supabaseからトークンを取得中...");
const { data: tokenData, error: fetchError } = await supabase
  .from("tanita_tokens")
  .select("*")
  .limit(1)
  .single();

if (fetchError || !tokenData) {
  console.error("❌ トークン取得エラー:", fetchError?.message);
  Deno.exit(1);
}

console.log(`   Current Expires At: ${tokenData.expires_at}`);

// 2. トークンをリフレッシュ
console.log("\n🔄 トークンをリフレッシュ中...");
const params = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uri: redirectUri,  // ← これを追加
  refresh_token: tokenData.refresh_token,
  grant_type: "refresh_token",
});

const response = await fetch("https://www.healthplanet.jp/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: params.toString(),
});

if (!response.ok) {
  const errorText = await response.text();
  console.error(`❌ リフレッシュエラー: ${response.status}`);
  console.error(errorText);
  Deno.exit(1);
}

const newTokens = await response.json();
const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

console.log("✅ リフレッシュ成功");
console.log(`   New Access Token: ${newTokens.access_token.substring(0, 20)}...`);
console.log(`   New Expires At: ${expiresAt.toISOString()}`);

// 3. Supabaseに保存
console.log("\n💾 Supabaseに保存中...");
const { error: updateError } = await supabase
  .from("tanita_tokens")
  .update({
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    expires_at: expiresAt.toISOString(),
    last_refreshed_at: new Date().toISOString(),
  })
  .eq("id", tokenData.id);

if (updateError) {
  console.error("❌ 保存エラー:", updateError.message);
  Deno.exit(1);
}

console.log("✅ 完了！トークンをリフレッシュしてSupabaseに保存しました");