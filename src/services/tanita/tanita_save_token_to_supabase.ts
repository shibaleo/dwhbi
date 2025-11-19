// tanita_save_token_to_supabase.ts
// TanitaトークンをSupabaseに保存
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface TanitaTokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
}

// 環境変数取得
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const accessToken = Deno.env.get("TANITA_ACCESS_TOKEN");
const refreshToken = Deno.env.get("TANITA_REFRESH_TOKEN");
const expiresIn = Deno.env.get("TANITA_EXPIRES_IN");

// バリデーション
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase接続情報が設定されていません");
  console.error("   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY を設定してください");
  Deno.exit(1);
}

if (!accessToken || !refreshToken || !expiresIn) {
  console.error("❌ Tanitaトークン情報が設定されていません");
  console.error("   TANITA_ACCESS_TOKEN, TANITA_REFRESH_TOKEN, TANITA_EXPIRES_IN を設定してください");
  Deno.exit(1);
}

// Supabaseクライアント初期化
const supabase = createClient(supabaseUrl, supabaseKey);

// expires_atを計算
const expiresAt = new Date(Date.now() + parseInt(expiresIn) * 1000);

console.log("💾 Supabaseにトークンを保存中...");
console.log(`   Access Token: ${accessToken.substring(0, 20)}...`);
console.log(`   Expires At: ${expiresAt.toISOString()}`);

// 既存レコードがあるか確認
const { data: existing, error: selectError } = await supabase
  .from("tanita_tokens")
  .select("id")
  .limit(1)
  .maybeSingle();

if (selectError) {
  console.error("❌ 既存レコード確認エラー:", selectError.message);
  Deno.exit(1);
}

let result;
if (existing) {
  // 既存レコードを更新
  console.log("📝 既存レコードを更新します");
  result = await supabase
    .from("tanita_tokens")
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt.toISOString(),
      token_type: "Bearer",
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
} else {
  // 新規レコードを挿入
  console.log("✨ 新規レコードを作成します");
  result = await supabase
    .from("tanita_tokens")
    .insert({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt.toISOString(),
      token_type: "Bearer",
      scope: "innerscan,sphygmomanometer,pedometer,smug",
      last_refreshed_at: new Date().toISOString(),
    });
}

if (result.error) {
  console.error("❌ 保存エラー:", result.error.message);
  Deno.exit(1);
}

console.log("✅ トークン保存完了！");