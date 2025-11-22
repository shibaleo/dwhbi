// test/tanita/manual/test_auth.ts
// 認証フローの手動テスト
//
// 実行:
//   deno run --allow-env --allow-net --allow-read test/tanita/manual/test_auth.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TANITA_CLIENT_ID, TANITA_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { ensureValidToken } from "../../../src/services/tanita/auth.ts";

console.log("=".repeat(60));
console.log("Tanita認証テスト");
console.log("=".repeat(60));
console.log("");

try {
  console.log("📋 環境変数チェック:");
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TANITA_CLIENT_ID",
    "TANITA_CLIENT_SECRET",
  ];

  for (const key of required) {
    const value = Deno.env.get(key);
    console.log(`   ${key}: ${value ? "✓ 設定済み" : "✗ 未設定"}`);
  }
  console.log("");

  // トークン取得テスト
  console.log("🔑 トークン取得テスト:");
  const token = await ensureValidToken();
  console.log(`   アクセストークン: ${token.substring(0, 20)}...`);
  console.log("");

  console.log("=".repeat(60));
  console.log("✅ 認証テスト成功");
  console.log("=".repeat(60));
} catch (error) {
  console.error("");
  console.error("=".repeat(60));
  console.error("❌ 認証テスト失敗");
  console.error(`   エラー: ${error instanceof Error ? error.message : error}`);
  console.error("=".repeat(60));
  Deno.exit(1);
}
