// test/fitbit/check_auth.ts
// 認証フローの確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/fitbit/check_auth.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { ensureValidToken } from "../../src/services/fitbit/auth.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Fitbit 認証確認");
  console.log("=".repeat(60));

  try {
    // 環境変数チェック
    console.log("\n📋 環境変数チェック:");
    const required = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "FITBIT_CLIENT_ID",
      "FITBIT_CLIENT_SECRET",
    ];

    let allSet = true;
    for (const key of required) {
      const value = Deno.env.get(key);
      const status = value ? "✅" : "❌";
      console.log(`   ${status} ${key}`);
      if (!value) allSet = false;
    }

    if (!allSet) {
      console.error("\n❌ 必要な環境変数が設定されていません");
      Deno.exit(1);
    }

    // トークン取得テスト
    console.log("\n🔑 トークン取得:");
    const token = await ensureValidToken();
    console.log(`   トークン長: ${token.length}文字`);
    console.log(`   プレビュー: ${token.substring(0, 30)}...`);

    console.log("\n" + "=".repeat(60));
    console.log("✅ 認証確認成功");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
