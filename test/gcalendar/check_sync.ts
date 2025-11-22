// test/gcalendar/check_sync.ts
// 日次同期の確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/gcalendar/check_sync.ts
//
// 必要な環境変数:
//   GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { fetchEventsByDays } from "../../src/services/gcalendar/fetch_events.ts";
import { createGCalClient, upsertEvents } from "../../src/services/gcalendar/write_db.ts";

async function main() {
  const days = 7;

  console.log("=".repeat(60));
  console.log(`Google Calendar 同期確認（直近${days}日分）`);
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  try {
    // データ取得
    console.log("\n📥 Google Calendar APIからデータ取得...");
    const { events, raw } = await fetchEventsByDays(days);

    console.log(`   ✅ 取得: ${raw.length} 件`);
    console.log(`   ✅ 変換: ${events.length} 件`);

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
    const allDayCount = events.filter((e) => e.is_all_day).length;
    const regularCount = events.length - allDayCount;
    console.log("\n📊 イベント種別:");
    console.log(`     通常イベント: ${regularCount} 件`);
    console.log(`     終日イベント: ${allDayCount} 件`);

    // DB接続
    console.log("\n📤 Supabaseに接続...");
    const client = createGCalClient();
    console.log("   ✅ 接続成功");

    // イベント同期
    console.log("\n📤 イベント同期...");
    const upsertedCount = await upsertEvents(client, events);
    console.log(`   ✅ ${upsertedCount} 件をupsert`);

    // サマリー
    console.log("\n" + "=".repeat(60));
    console.log("✅ 同期確認完了");
    console.log("=".repeat(60));
    console.log("\n📊 同期結果:");
    console.log(`   取得: ${raw.length} 件`);
    console.log(`   変換: ${events.length} 件`);
    console.log(`   upsert: ${upsertedCount} 件`);
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
