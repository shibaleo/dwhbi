// tanita_get_initial_token.ts
// 初回認可コードからトークンを取得（すべて環境変数から）
import "https://deno.land/std@0.203.0/dotenv/load.ts";
const clientId = Deno.env.get("TANITA_CLIENT_ID");
const clientSecret = Deno.env.get("TANITA_CLIENT_SECRET");
const code = Deno.env.get("TANITA_AUTH_CODE");
const redirectUri = "https://www.healthplanet.jp/success.html";

// 環境変数チェック
if (!clientId) {
  console.error("❌ TANITA_CLIENT_IDが設定されていません");
  Deno.exit(1);
}

if (!clientSecret) {
  console.error("❌ TANITA_CLIENT_SECRETが設定されていません");
  Deno.exit(1);
}

if (!code) {
  console.error("❌ TANITA_AUTH_CODEが設定されていません");
  Deno.exit(1);
}

const params = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uri: redirectUri,
  code: code,
  grant_type: "authorization_code",
});

console.log("🔄 認可コードをトークンに交換中...");
console.log(`   Client ID: ${clientId.substring(0, 20)}...`);

const response = await fetch("https://www.healthplanet.jp/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: params.toString(),
});

if (!response.ok) {
  const errorText = await response.text();
  console.error(`❌ エラー: ${response.status} ${response.statusText}`);
  console.error(errorText);
  Deno.exit(1);
}

const data = await response.json();

console.log("✅ トークン取得成功！");
console.log("\n📄 以下の情報を環境変数に保存してください：");
console.log(`TANITA_ACCESS_TOKEN=${data.access_token}`);
console.log(`TANITA_REFRESH_TOKEN=${data.refresh_token}`);
console.log(`\nExpires in: ${data.expires_in} seconds (${data.expires_in / 86400} days)`);

// JSON形式でも出力
console.log("\n📄 JSON出力:");
console.log(JSON.stringify({
  access_token: data.access_token,
  refresh_token: data.refresh_token,
  expires_in: data.expires_in,
  expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
}, null, 2));