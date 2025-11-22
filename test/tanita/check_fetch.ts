// test/tanita/check_fetch.ts
// API データ取得の確認スクリプト（DB書き込みなし）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/tanita/check_fetch.ts
//   TANITA_TEST_DAYS=30 deno run --allow-env --allow-net --allow-read test/tanita/check_fetch.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TANITA_CLIENT_ID, TANITA_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { ensureValidToken } from "../../src/services/tanita/auth.ts";
import { fetchTanitaData } from "../../src/services/tanita/fetch_data.ts";

const DEFAULT_DAYS = 7;

async function main() {
  console.log("=".repeat(60));
  console.log("Tanita API データ取得確認");
  console.log("=".repeat(60));

  try {
    // トークン取得
    console.log("\n🔑 トークン取得中...");
    const token = await ensureValidToken();

    // データ取得
    const days = parseInt(Deno.env.get("TANITA_TEST_DAYS") || String(DEFAULT_DAYS));
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    console.log(`\n📥 データ取得中（${days}日間）...`);

    const data = await fetchTanitaData(token, { startDate, endDate });

    // 結果サマリー
    console.log("\n" + "=".repeat(60));
    console.log("📊 取得結果サマリー");
    console.log("=".repeat(60));
    console.log(`   体組成データ: ${data.bodyComposition.length}件`);
    console.log(`   血圧データ:   ${data.bloodPressure.length}件`);
    console.log(`   歩数データ:   ${data.steps.length}件`);

    // サンプルデータ
    if (data.bodyComposition.length > 0) {
      console.log("\n📋 体組成サンプル（最新3件）:");
      const samples = data.bodyComposition.slice(-3);
      for (const item of samples) {
        console.log(`   ${item.date} | tag=${item.tag} | value=${item.keydata}`);
      }
    }

    if (data.bloodPressure.length > 0) {
      console.log("\n📋 血圧サンプル（最新3件）:");
      const samples = data.bloodPressure.slice(-3);
      for (const item of samples) {
        console.log(`   ${item.date} | tag=${item.tag} | value=${item.keydata}`);
      }
    }

    if (data.steps.length > 0) {
      console.log("\n📋 歩数サンプル（最新3件）:");
      const samples = data.steps.slice(-3);
      for (const item of samples) {
        console.log(`   ${item.date} | tag=${item.tag} | value=${item.keydata}`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ データ取得確認成功");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
