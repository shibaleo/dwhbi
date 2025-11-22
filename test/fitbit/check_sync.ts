// test/fitbit/check_sync.ts
// 日次同期の確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/fitbit/check_sync.ts
//   FITBIT_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/check_sync.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import { syncFitbitByDays } from "../../src/services/fitbit/sync_daily.ts";

const DEFAULT_DAYS = 3;

async function main() {
  console.log("=".repeat(60));
  console.log("Fitbit 日次同期確認");
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  try {
    const days = parseInt(Deno.env.get("FITBIT_SYNC_DAYS") || String(DEFAULT_DAYS));

    console.log(`\n📝 設定:`);
    console.log(`   同期日数: ${days}日間`);

    const result = await syncFitbitByDays(days);

    console.log("\n" + "=".repeat(60));
    if (result.success) {
      console.log("✅ 同期確認成功");
    } else {
      console.log("⚠️  同期完了（エラーあり）");
      console.log(`   エラー: ${result.errors.join(", ")}`);
    }
    console.log("=".repeat(60));

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
