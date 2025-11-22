// test/toggl/manual/check_sync.ts
// 少量データでの同期動作確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/toggl/manual/check_sync.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchAllData } from "../../../src/services/toggl/api.ts";
import {
  createTogglClient,
  upsertMetadata,
  upsertEntries,
} from "../../../src/services/toggl/write_db.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("Toggl 同期動作確認（直近1日分）");
  console.log("=".repeat(50));

  const days = 1;
  console.log(`\n📅 対象期間: 直近 ${days} 日間`);

  try {
    // 1. データ取得
    console.log("\n📥 Toggl APIからデータ取得...");
    const data = await fetchAllData(days);

    console.log(`  ✅ クライアント: ${data.clients.length} 件`);
    console.log(`  ✅ プロジェクト: ${data.projects.length} 件`);
    console.log(`  ✅ タグ: ${data.tags.length} 件`);
    console.log(`  ✅ エントリー: ${data.entries.length} 件`);

    // 実行中エントリーの数を確認
    const runningEntries = data.entries.filter(e => e.duration < 0);
    if (runningEntries.length > 0) {
      console.log(`     (うち実行中: ${runningEntries.length} 件 → スキップされます)`);
    }

    // 2. DB接続
    console.log("\n📤 Supabaseに接続...");
    const toggl = createTogglClient();
    console.log("  ✅ 接続成功");

    // 3. メタデータ同期
    console.log("\n📤 メタデータ同期...");
    const metadataResult = await upsertMetadata(
      toggl,
      data.clients,
      data.projects,
      data.tags
    );
    console.log(`  ✅ クライアント: ${metadataResult.clients} 件`);
    console.log(`  ✅ プロジェクト: ${metadataResult.projects} 件`);
    console.log(`  ✅ タグ: ${metadataResult.tags} 件`);

    // 4. エントリー同期
    console.log("\n📤 エントリー同期...");
    const entriesCount = await upsertEntries(toggl, data.entries);
    console.log(`  ✅ エントリー: ${entriesCount} 件`);

    // 5. サマリー
    console.log("\n" + "=".repeat(50));
    console.log("✅ 同期動作確認完了");
    console.log("=".repeat(50));
    console.log("\n📊 同期結果:");
    console.log(`   クライアント: ${metadataResult.clients} 件`);
    console.log(`   プロジェクト: ${metadataResult.projects} 件`);
    console.log(`   タグ: ${metadataResult.tags} 件`);
    console.log(`   エントリー: ${entriesCount} 件`);

  } catch (error) {
    console.error("\n❌ エラー発生:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

main();
