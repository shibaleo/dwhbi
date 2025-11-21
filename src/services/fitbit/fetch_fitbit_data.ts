// fetch_fitbit_data.ts - Fitbitデータ取得のCLIエントリーポイント
// 手動実行やスケジュール実行から呼ばれることを想定

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { fetchFitbitData } from "./fetch.ts";

if (import.meta.main) {
  const args = Deno.args;

  try {
    let startDate: string;
    let endDate: string;
    let forceRefresh = false;

    // --force オプションをチェック
    if (args.includes("--force")) {
      forceRefresh = true;
      args.splice(args.indexOf("--force"), 1);
    }

    if (args.length === 0) {
      // 引数なし: 過去7日間
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 7);
      startDate = start.toISOString().split("T")[0];
      endDate = end.toISOString().split("T")[0];
    } else if (args.length === 1) {
      startDate = endDate = args[0];
    } else if (args.length === 2) {
      startDate = args[0];
      endDate = args[1];
    } else {
      console.log("Usage:");
      console.log("  deno run --allow-all fetch_fitbit_data.ts [--force]");
      console.log("  deno run --allow-all fetch_fitbit_data.ts [--force] 2025-01-15");
      console.log("  deno run --allow-all fetch_fitbit_data.ts [--force] 2023-01-01 2025-01-31");
      console.log("\nOptions:");
      console.log("  --force    Skip cache and fetch fresh data from Fitbit");
      Deno.exit(1);
    }

    await fetchFitbitData(startDate, endDate, { forceRefresh });
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    Deno.exit(1);
  }
}
