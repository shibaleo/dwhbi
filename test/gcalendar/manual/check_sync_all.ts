// test/gcalendar/manual/check_sync_all.ts
// 全件同期動作確認スクリプト（期間指定）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/gcalendar/manual/check_sync_all.ts
//
// または直接sync_all.tsを実行:
//   deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_all.ts --help
//   deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_all.ts --start=2025-11-01 --end=2025-11-22

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { syncAllGCalEvents } from "../../../src/services/gcalendar/sync_all.ts";

async function main() {
  console.log("=".repeat(60));
  console.log("Google Calendar 全件同期動作確認（テスト用短期間）");
  console.log("=".repeat(60));

  // テスト用に2025年11月を同期
  const startDateStr = "2025-11-01";
  const endDateStr = "2025-11-30";

  console.log(`\n📅 テスト期間: ${startDateStr} 〜 ${endDateStr}\n`);

  try {
    const result = await syncAllGCalEvents(startDateStr, endDateStr);

    if (result.success) {
      console.log("\n✅ 全件同期テスト成功");
    } else {
      console.log("\n❌ 全件同期テスト失敗");
      Deno.exit(1);
    }
  } catch (error) {
    console.error("\n❌ エラー発生:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

main();
