// tanita_refresh_and_save.ts
// SupabaseからTanitaトークンを取得→必要に応じてリフレッシュ→再保存

import { createClient } from "npm:@supabase/supabase-js@2";

// 環境変数取得
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const clientId = Deno.env.get("TANITA_CLIENT_ID");
const clientSecret = Deno.env.get("TANITA_CLIENT_SECRET");
const redirectUri = "https://www.healthplanet.jp/success.html";

// リフレッシュする閾値（日数）
const REFRESH_THRESHOLD_DAYS = 7;

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

const expiresAt = new Date(tokenData.expires_at);
const now = new Date();
const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

console.log(`   Current Expires At: ${tokenData.expires_at}`);
console.log(`   Days until expiry: ${daysUntilExpiry.toFixed(1)}`);

// 2. 有効期限チェック
if (daysUntilExpiry > REFRESH_THRESHOLD_DAYS) {
  console.log(`\n✅ トークンはまだ有効です（残り${daysUntilExpiry.toFixed(1)}日）`);
  console.log(`   リフレッシュは${REFRESH_THRESHOLD_DAYS}日前から実行されます`);
  Deno.exit(0);
}

// 3. トークンをリフレッシュ
console.log(`\n🔄 トークンをリフレッシュ中...（有効期限まで${daysUntilExpiry.toFixed(1)}日）`);
const params = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uri: redirectUri,
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

console.log(`   Response Status: ${response.status} ${response.statusText}`);

if (!response.ok) {
  const errorText = await response.text();
  console.error(`❌ リフレッシュエラー: ${response.status}`);
  console.error(errorText);
  Deno.exit(1);
}

// レスポンスボディを取得
const responseText = await response.text();

// "SUCCESS"だけの場合は既にリフレッシュされている
if (responseText.trim() === "SUCCESS") {
  console.log("✅ トークンは既に最新です（APIがSUCCESSを返しました）");
  console.log("   データベースの更新は不要です");
  Deno.exit(0);
}

// JSONパース
let newTokens;
try {
  newTokens = JSON.parse(responseText);
} catch (e) {
  console.error("❌ JSONパースエラー");
  console.error("Response body:", responseText);
  Deno.exit(1);
}

const expiresAtNew = new Date(Date.now() + newTokens.expires_in * 1000);

console.log("✅ リフレッシュ成功");
console.log(`   New Access Token: ${newTokens.access_token.substring(0, 20)}...`);
console.log(`   New Expires At: ${expiresAtNew.toISOString()}`);

// 4. Supabaseに保存
console.log("\n💾 Supabaseに保存中...");
const { error: updateError } = await supabase
  .from("tanita_tokens")
  .update({
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    expires_at: expiresAtNew.toISOString(),
    last_refreshed_at: new Date().toISOString(),
  })
  .eq("id", tokenData.id);

if (updateError) {
  console.error("❌ 保存エラー:", updateError.message);
  Deno.exit(1);
}

console.log("✅ 完了！トークンをリフレッシュしてSupabaseに保存しました");