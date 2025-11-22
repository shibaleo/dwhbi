// test/gcalendar/manual/check_api.ts
// Google Calendar API 疎通確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/gcalendar/manual/check_api.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { getAccessToken, loadCredentials } from "../../../src/services/gcalendar/auth.ts";
import { fetchEvents, getCalendarId } from "../../../src/services/gcalendar/api.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("Google Calendar API 疎通確認");
  console.log("=".repeat(50));

  try {
    // 1. 認証情報の読み込み確認
    console.log("\n🔐 認証情報の読み込み...");
    const credentials = loadCredentials();
    console.log(`  ✅ サービスアカウント: ${credentials.client_email}`);
    console.log(`  ✅ プロジェクトID: ${credentials.project_id}`);

    // 2. アクセストークン取得
    console.log("\n🔑 アクセストークン取得...");
    const accessToken = await getAccessToken();
    console.log(`  ✅ トークン取得成功（長さ: ${accessToken.length}文字）`);

    // 3. カレンダーID確認
    console.log("\n📅 カレンダーID確認...");
    const calendarId = getCalendarId();
    console.log(`  ✅ カレンダーID: ${calendarId}`);

    // 4. イベント取得テスト（直近7日）
    console.log("\n📋 イベント取得テスト（直近7日）...");
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const events = await fetchEvents({
      calendarId,
      timeMin: sevenDaysAgo.toISOString(),
      timeMax: now.toISOString(),
    });

    console.log(`  ✅ ${events.length} 件のイベントを取得`);

    // イベントのサンプルを表示
    if (events.length > 0) {
      console.log("\n📌 取得したイベントのサンプル（最大5件）:");
      const samples = events.slice(0, 5);
      for (const event of samples) {
        const startTime = event.start.dateTime ?? event.start.date;
        const isAllDay = !event.start.dateTime;
        console.log(`     - ${event.summary ?? "(タイトルなし)"}`);
        console.log(`       開始: ${startTime}${isAllDay ? " (終日)" : ""}`);
        console.log(`       colorId: ${event.colorId ?? "なし"}, status: ${event.status ?? "なし"}`);
      }
    }

    // ステータス別の集計
    const statusCount: Record<string, number> = {};
    for (const event of events) {
      const status = event.status ?? "unknown";
      statusCount[status] = (statusCount[status] || 0) + 1;
    }
    console.log("\n📊 ステータス別集計:");
    for (const [status, count] of Object.entries(statusCount)) {
      console.log(`     ${status}: ${count} 件`);
    }

    // colorId別の集計
    const colorCount: Record<string, number> = {};
    for (const event of events) {
      const colorId = event.colorId ?? "なし";
      colorCount[colorId] = (colorCount[colorId] || 0) + 1;
    }
    console.log("\n🎨 colorId別集計:");
    for (const [colorId, count] of Object.entries(colorCount)) {
      console.log(`     colorId ${colorId}: ${count} 件`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Google Calendar APIへの接続成功");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("\n❌ エラー発生:", error instanceof Error ? error.message : error);
    console.error("\n環境変数を確認してください:");
    console.error("  - GOOGLE_CALENDAR_ID");
    console.error("  - GOOGLE_SERVICE_ACCOUNT_JSON");
    console.error("\nまた、サービスアカウントがカレンダーに共有されているか確認してください。");
    Deno.exit(1);
  }
}

main();
