// test/gcalendar/manual/check_sync.ts
// 少量データでの同期動作確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/gcalendar/manual/check_sync.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchEventsByDays } from "../../../src/services/gcalendar/fetch_events.ts";
import { createGCalClient, upsertEvents } from "../../../src/services/gcalendar/write_db.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("Google Calendar 同期動作確認（直近7日分）");
  console.log("=".repeat(50));

  const days = 7;
  console.log(`\n📅 対象期間: 直近 ${days} 日間`);

  try {
    // 1. データ取得
    console.log("\n📥 Google Calendar APIからデータ取得...");
    const { events, raw } = await fetchEventsByDays(days);

    console.log(`  ✅ 取得: ${raw.length} 件`);
    console.log(`  ✅ 変換: ${events.length} 件`);

    // ステータス別集計
    const statusCount: Record<string, number> = {};
    for (const event of events) {
      const status = event.status ?? "unknown";
      statusCount[status] = (statusCount[status] || 0) + 1;
    }
    console.log("\n📊 ステータス別:");
    for (const [status, count] of Object.entries(statusCount)) {
      console.log(`     ${status}: ${count} 件`);
    }

    // 終日イベント集計
    const allDayCount = events.filter(e => e.is_all_day).length;
    const regularCount = events.length - allDayCount;
    console.log(`\n📊 イベント種別:`);
    console.log(`     通常イベント: ${regularCount} 件`);
    console.log(`     終日イベント: ${allDayCount} 件`);

    // 2. DB接続
    console.log("📤 Supabaseに接続...");
    const client = createGCalClient();
    console.log("  ✅ 接続成功");

    // 3. イベント同期
    console.log("\n📤 イベント同期...");
    const upsertedCount = await upsertEvents(client, events);
    console.log(`  ✅ ${upsertedCount} 件をupsert`);

    // 4. サマリー
    console.log("\n" + "=".repeat(50));
    console.log("✅ 同期動作確認完了");
    console.log("=".repeat(50));
    console.log("\n📊 同期結果:");
    console.log(`   取得: ${raw.length} 件`);
    console.log(`   変換: ${events.length} 件`);
    console.log(`   upsert: ${upsertedCount} 件`);

  } catch (error) {
    console.error("\n❌ エラー発生:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

main();
