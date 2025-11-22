// test/tanita/check_all.ts
// Tanita 全確認スクリプト一括実行
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/tanita/check_all.ts
//   deno run --allow-env --allow-net --allow-read test/tanita/check_all.ts --sync
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TANITA_CLIENT_ID, TANITA_CLIENT_SECRET

import "jsr:@std/dotenv/load";
import * as log from "../_utils/log.ts";
import { ensureValidToken } from "../../src/services/tanita/auth.ts";
import { fetchTanitaData } from "../../src/services/tanita/fetch_data.ts";
import { syncTanitaByDays } from "../../src/services/tanita/sync_daily.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCHEMA = "tanita";
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

  const data = await fetchTanitaData(token, { startDate, endDate });

  log.success(`Body Composition: ${data.bodyComposition.length}`);
  log.success(`Blood Pressure: ${data.bloodPressure.length}`);
  log.success(`Steps: ${data.steps.length}`);
}

async function checkDb(): Promise<void> {
  log.section("[3/4] DB Status");

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  const tables = ["body_composition", "blood_pressure", "steps"];
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

  const result = await syncTanitaByDays(TEST_DAYS);

  if (result.success) {
    log.success(`Sync completed (${result.elapsedSeconds.toFixed(1)}s)`);
    log.info(`Body Composition: ${result.stats.bodyComposition}`);
    log.info(`Blood Pressure: ${result.stats.bloodPressure}`);
    log.info(`Steps: ${result.stats.steps}`);
  } else {
    log.warn(`Sync completed with errors: ${result.errors.join(", ")}`);
  }
}

async function main() {
  const includeSync = Deno.args.includes("--sync");

  log.header("Tanita Check", { syncMode: includeSync });

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
