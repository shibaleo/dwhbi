// test/toggl/manual/check_api.ts
// Toggl API 疎通確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/toggl/manual/check_api.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import {
  fetchClients,
  fetchProjects,
  fetchTags,
  fetchEntries,
} from "../../../src/services/toggl/api.ts";

async function main() {
  console.log("=".repeat(50));
  console.log("Toggl API 疎通確認");
  console.log("=".repeat(50));

  try {
    // 1. クライアント取得
    console.log("\n📋 クライアント取得...");
    const clients = await fetchClients();
    console.log(`  ✅ ${clients.length} 件のクライアントを取得`);
    if (clients.length > 0) {
      const sample = clients[0];
      console.log(`     例: id=${sample.id}, name=${sample.name}`);
    }

    // 2. プロジェクト取得
    console.log("\n📋 プロジェクト取得...");
    const projects = await fetchProjects();
    console.log(`  ✅ ${projects.length} 件のプロジェクトを取得`);
    if (projects.length > 0) {
      const sample = projects[0];
      console.log(`     例: id=${sample.id}, name=${sample.name}, active=${sample.active}`);
    }

    // 3. タグ取得
    console.log("\n📋 タグ取得...");
    const tags = await fetchTags();
    console.log(`  ✅ ${tags.length} 件のタグを取得`);
    if (tags.length > 0) {
      const sample = tags[0];
      console.log(`     例: id=${sample.id}, name=${sample.name}`);
    }

    // 4. タイムエントリー取得（直近1日）
    console.log("\n📋 タイムエントリー取得（直近1日）...");
    const entries = await fetchEntries(1);
    const runningCount = entries.filter(e => e.duration < 0).length;
    const completedCount = entries.length - runningCount;
    console.log(`  ✅ ${entries.length} 件のエントリーを取得`);
    console.log(`     (完了: ${completedCount} 件, 実行中: ${runningCount} 件)`);
    
    // 完了済みエントリーからサンプルを表示
    const completedEntry = entries.find(e => e.duration >= 0);
    if (completedEntry) {
      const durationMin = Math.round(completedEntry.duration / 60);
      console.log(`     例: id=${completedEntry.id}, duration=${durationMin}min, project_id=${completedEntry.project_id}`);
      if (completedEntry.description) {
        console.log(`     description="${completedEntry.description.substring(0, 30)}${completedEntry.description.length > 30 ? '...' : ''}"`);
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ すべてのAPIエンドポイントに正常接続");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("\n❌ エラー発生:", error instanceof Error ? error.message : error);
    console.error("\n環境変数を確認してください:");
    console.error("  - TOGGL_API_TOKEN");
    console.error("  - TOGGL_WORKSPACE_ID");
    Deno.exit(1);
  }
}

main();
