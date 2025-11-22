// test/fitbit/check_all.ts
// Fitbit 全確認スクリプト一括実行
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/fitbit/check_all.ts
//   deno run --allow-env --allow-net --allow-read test/fitbit/check_all.ts --sync
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import * as log from "../_utils/log.ts";
import { ensureValidToken } from "../../src/services/fitbit/auth.ts";
import { fetchFitbitData } from "../../src/services/fitbit/fetch_data.ts";
import { syncFitbitByDays } from "../../src/services/fitbit/sync_daily.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCHEMA = "fitbit";
const TEST_DAYS = 1;

async function checkAuth(): Promise<string> {
  log.section("[1/4] Auth Check");
  const token = await ensureValidToken();
  log.success(`Token: ${token.length} chars`);
  return token;
}

async function checkFetch(token: string): Promise<void> {
  log.section(`[2/4] Data Fetch (${TEST_DAYS} days)`);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - TEST_DAYS * 24 * 60 * 60 * 1000);

  const data = await fetchFitbitData(token, { startDate, endDate });

  log.success(`Sleep: ${data.sleep.length}`);
  log.success(`Activity: ${data.activity.size} days`);
  log.success(`Heart Rate: ${data.heartRate.length} days`);
  log.success(`HRV: ${data.hrv.length} days`);
  log.success(`SpO2: ${data.spo2.size} days`);
}

async function checkDb(): Promise<void> {
  log.section("[3/4] DB Status");

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  const tables = ["sleep", "activity_daily", "heart_rate_daily", "hrv_daily", "spo2_daily"];
  for (const table of tables) {
    const { count } = await supabase
      .schema(SCHEMA)
      .from(table)
      .select("*", { count: "exact", head: true });
    log.info(`${table}: ${count ?? 0}`);
  }
}

async function checkSync(): Promise<void> {
  log.section(`[4/4] Sync Test (${TEST_DAYS} days)`);
  log.warn("Writing to DB");

  const result = await syncFitbitByDays(TEST_DAYS);

  if (result.success) {
    log.success("Sync completed");
  } else {
    log.warn(`Sync completed with errors: ${result.errors.join(", ")}`);
  }
}

async function main() {
  const includeSync = Deno.args.includes("--sync");

  log.header("Fitbit Check", { syncMode: includeSync });

  try {
    const token = await checkAuth();
    await checkFetch(token);
    await checkDb();

    if (includeSync) {
      await checkSync();
      await checkDb();
    }

    log.footer(true);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    log.footer(false);
    Deno.exit(1);
  }
}

main();
