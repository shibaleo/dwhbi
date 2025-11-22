// test/toggl/check_all.ts
// Toggl 全確認スクリプト一括実行
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/toggl/check_all.ts
//   deno run --allow-env --allow-net --allow-read test/toggl/check_all.ts --sync
//
// 必要な環境変数:
//   TOGGL_API_TOKEN, TOGGL_WORKSPACE_ID
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import * as log from "../_utils/log.ts";
import {
  fetchClients,
  fetchProjects,
  fetchTags,
  fetchEntries,
} from "../../src/services/toggl/api.ts";
import { fetchAllData } from "../../src/services/toggl/fetch_data.ts";
import {
  createTogglDbClient,
  upsertMetadata,
  upsertEntries,
} from "../../src/services/toggl/write_db.ts";

const TEST_DAYS = 1;

async function checkApi(): Promise<void> {
  log.section("[1/3] API Connection");

  const clients = await fetchClients();
  log.success(`Clients: ${clients.length}`);

  const projects = await fetchProjects();
  log.success(`Projects: ${projects.length}`);

  const tags = await fetchTags();
  log.success(`Tags: ${tags.length}`);

  const entries = await fetchEntries(TEST_DAYS);
  const runningCount = entries.filter((e) => e.duration < 0).length;
  log.success(`Entries: ${entries.length} (running: ${runningCount})`);
}

async function checkDb(): Promise<void> {
  log.section("[2/3] DB Status");

  const toggl = createTogglDbClient();

  const tables = ["clients", "projects", "tags", "entries"];
  for (const table of tables) {
    const { count } = await toggl
      .from(table)
      .select("*", { count: "exact", head: true });
    log.info(`${table}: ${count ?? 0}`);
  }
}

async function checkSync(): Promise<void> {
  log.section(`[3/3] Sync Test (${TEST_DAYS} days)`);
  log.warn("Writing to DB");

  const data = await fetchAllData(TEST_DAYS);
  const toggl = createTogglDbClient();

  const metadataResult = await upsertMetadata(
    toggl,
    data.clients,
    data.projects,
    data.tags
  );
  log.success(`Clients: ${metadataResult.clients.success}`);
  log.success(`Projects: ${metadataResult.projects.success}`);
  log.success(`Tags: ${metadataResult.tags.success}`);

  const entriesResult = await upsertEntries(toggl, data.entries);
  log.success(`Entries: ${entriesResult.success}`);
}

async function main() {
  const includeSync = Deno.args.includes("--sync");

  log.header("Toggl Check", { syncMode: includeSync });

  try {
    await checkApi();
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
