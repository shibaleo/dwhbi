// test/tanita/check_sync.ts
// 日次同期の確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/tanita/check_sync.ts
//   TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/tanita/check_sync.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TANITA_CLIENT_ID, TANITA_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { syncTanitaByDays } from "../../src/services/tanita/sync_daily.ts";

const DEFAULT_DAYS = 3;

async function main() {
  console.log("=".repeat(60));
  console.log("Tanita 日次同期確認");
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  try {
    const days = parseInt(Deno.env.get("TANITA_SYNC_DAYS") || String(DEFAULT_DAYS));

    console.log(`\n📝 設定:`);
    console.log(`   同期日数: ${days}日間`);

    const result = await syncTanitaByDays(days);

    // 結果サマリー
    console.log("\n" + "=".repeat(60));
    console.log("📊 同期結果");
    console.log("=".repeat(60));
    console.log(`   成功: ${result.success ? "✅" : "❌"}`);
    console.log(`   処理時間: ${result.elapsedSeconds.toFixed(1)}秒`);
    console.log("\n   保存件数:");
    console.log(`     体組成: ${result.stats.bodyComposition}件`);
    console.log(`     血圧:   ${result.stats.bloodPressure}件`);
    console.log(`     歩数:   ${result.stats.steps}件`);

    if (result.errors.length > 0) {
      console.log("\n   エラー:");
      for (const err of result.errors) {
        console.log(`     - ${err}`);
      }
    }

    console.log("\n" + "=".repeat(60));
    if (result.success) {
      console.log("✅ 同期確認成功");
    } else {
      console.log("⚠️  同期完了（エラーあり）");
    }
    console.log("=".repeat(60));

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
