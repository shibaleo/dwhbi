// test/toggl/debug_reports_api.ts
// Reports API v3 レスポンス構造確認用
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/toggl/debug_reports_api.ts

import "jsr:@std/dotenv/load";
import { formatDate } from "../../src/services/toggl/api.ts";
import { workspaceId } from "../../src/services/toggl/auth.ts";

const REPORTS_API_BASE_URL = "https://api.track.toggl.com/reports/api/v3";

async function debugReportsApi() {
  const apiToken = Deno.env.get("TOGGL_API_TOKEN")?.trim();
  if (!apiToken) {
    throw new Error("TOGGL_API_TOKEN is not set");
  }

  // 直近3日間
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 3);

  const requestBody = {
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    page_size: 5, // 少量だけ取得
    order_by: "date",
    order_dir: "ASC",
  };

  console.log("Request:", JSON.stringify(requestBody, null, 2));
  console.log(`Workspace ID: ${workspaceId}`);
  console.log("");

  const url = `${REPORTS_API_BASE_URL}/workspace/${workspaceId}/search/time_entries`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${btoa(`${apiToken}:api_token`)}`,
    },
    body: JSON.stringify(requestBody),
  });

  console.log(`Status: ${res.status}`);
  console.log("Headers:");
  console.log(`  X-Next-Row-Number: ${res.headers.get("X-Next-Row-Number")}`);
  console.log(`  X-Toggl-Quota-Remaining: ${res.headers.get("X-Toggl-Quota-Remaining")}`);
  console.log("");

  const data = await res.json();

  console.log("Response (first 2 entries):");
  if (Array.isArray(data)) {
    console.log(`Total entries: ${data.length}`);
    
    // time_entries配列のサイズを確認
    const multipleTimeEntries = data.filter((e: any) => e.time_entries && e.time_entries.length > 1);
    console.log(`Entries with multiple time_entries: ${multipleTimeEntries.length}`);
    
    const totalTimeEntries = data.reduce((sum: number, e: any) => sum + (e.time_entries?.length || 0), 0);
    console.log(`Total time_entries (sum): ${totalTimeEntries}`);
    console.log("");
    for (let i = 0; i < Math.min(2, data.length); i++) {
      console.log(`Entry ${i + 1}:`);
      console.log(JSON.stringify(data[i], null, 2));
      console.log("");
    }
  } else {
    console.log("Response is not an array:");
    console.log(JSON.stringify(data, null, 2));
  }
}

debugReportsApi().catch(console.error);
