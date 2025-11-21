// zaim/test_oauth.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimOAuth } from "../src/services/zaim/oauth.ts";

async function testOAuth() {
  console.log("=== Zaim OAuth Test ===\n");

  // 環境変数の確認
  const consumerKey = Deno.env.get("ZAIM_CONSUMER_KEY");
  const consumerSecret = Deno.env.get("ZAIM_CONSUMER_SECRET");
  const accessToken = Deno.env.get("ZAIM_ACCESS_TOKEN");
  const accessTokenSecret = Deno.env.get("ZAIM_ACCESS_TOKEN_SECRET");

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    console.error("❌ Error: Zaim API credentials not found in environment variables");
    Deno.exit(1);
  }

  console.log("✓ Environment variables loaded");

  // ZaimOAuthインスタンス作成
  const oauth = new ZaimOAuth({
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret,
  });

  console.log("✓ ZaimOAuth instance created\n");

  // ユーザー情報取得テスト
  try {
    console.log("Testing GET request: /home/user/verify");
    const userInfo = await oauth.get("https://api.zaim.net/v2/home/user/verify");
    console.log("✓ GET request successful");
    console.log("User info:", JSON.stringify(userInfo, null, 2));
  } catch (error) {
    console.error("❌ GET request failed:", error);
    Deno.exit(1);
  }

  console.log("\n=== All tests passed ===");
}

if (import.meta.main) {
  testOAuth();
}