// test/gcalendar/check_sync_all.ts
// 全件同期の確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/gcalendar/check_sync_all.ts
//
// または直接sync_all.tsを実行:
//   deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_all.ts --help
//   deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_all.ts --start=2025-11-01 --end=2025-11-22
//
// 必要な環境変数:
//   GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { syncAllGCalEvents } from "../../src/services/gcalendar/sync_all.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Google Calendar 全件同期確認");
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  // テスト用期間（環境変数で変更可能）
  const startDateStr = Deno.env.get("GCAL_TEST_START") || "2025-11-01";
  const endDateStr = Deno.env.get("GCAL_TEST_END") || "2025-11-30";

  console.log(`\n📅 テスト期間: ${startDateStr} 〜 ${endDateStr}`);

  try {
    const result = await syncAllGCalEvents(startDateStr, endDateStr);

    console.log("\n" + "=".repeat(60));
    if (result.success) {
      console.log("✅ 全件同期確認成功");
    } else {
      console.log("❌ 全件同期確認失敗");
      Deno.exit(1);
    }
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
