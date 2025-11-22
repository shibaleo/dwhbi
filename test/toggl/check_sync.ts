// test/toggl/check_sync.ts
// 同期動作確認スクリプト（⚠️ DB書き込みあり）
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/toggl/check_sync.ts
//
// 必要な環境変数:
//   TOGGL_API_TOKEN, TOGGL_WORKSPACE_ID
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { fetchAllData } from "../../src/services/toggl/api.ts";
import {
  createTogglClient,
  upsertMetadata,
  upsertEntries,
} from "../../src/services/toggl/write_db.ts";

async function main() {
  const days = 1;

  console.log("=".repeat(60));
  console.log(`Toggl 同期確認（直近${days}日分）`);
  console.log("⚠️  実際にDBに書き込みます");
  console.log("=".repeat(60));

  try {
    // データ取得
    console.log("\n📥 Toggl APIからデータ取得...");
    const data = await fetchAllData(days);

    console.log(`   ✅ クライアント: ${data.clients.length} 件`);
    console.log(`   ✅ プロジェクト: ${data.projects.length} 件`);
    console.log(`   ✅ タグ: ${data.tags.length} 件`);
    console.log(`   ✅ エントリー: ${data.entries.length} 件`);

    // 実行中エントリーの数を確認
    const runningEntries = data.entries.filter((e) => e.duration < 0);
    if (runningEntries.length > 0) {
      console.log(`      (うち実行中: ${runningEntries.length} 件 → スキップ)`);
    }

    // DB接続
    console.log("\n📤 Supabaseに接続...");
    const toggl = createTogglClient();
    console.log("   ✅ 接続成功");

    // メタデータ同期
    console.log("\n📤 メタデータ同期...");
    const metadataResult = await upsertMetadata(
      toggl,
      data.clients,
      data.projects,
      data.tags
    );
    console.log(`   ✅ クライアント: ${metadataResult.clients} 件`);
    console.log(`   ✅ プロジェクト: ${metadataResult.projects} 件`);
    console.log(`   ✅ タグ: ${metadataResult.tags} 件`);

    // エントリー同期
    console.log("\n📤 エントリー同期...");
    const entriesCount = await upsertEntries(toggl, data.entries);
    console.log(`   ✅ エントリー: ${entriesCount} 件`);

    // サマリー
    console.log("\n" + "=".repeat(60));
    console.log("✅ 同期確認完了");
    console.log("=".repeat(60));
    console.log("\n📊 同期結果:");
    console.log(`   クライアント: ${metadataResult.clients} 件`);
    console.log(`   プロジェクト: ${metadataResult.projects} 件`);
    console.log(`   タグ: ${metadataResult.tags} 件`);
    console.log(`   エントリー: ${entriesCount} 件`);
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
