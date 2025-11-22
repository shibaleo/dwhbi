// test/zaim/check_all.ts
// Zaim 全確認スクリプト一括実行
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/zaim/check_all.ts
//   deno run --allow-env --allow-net --allow-read test/zaim/check_all.ts --sync
//
// 必要な環境変数:
//   ZAIM_CONSUMER_KEY, ZAIM_CONSUMER_SECRET
//   ZAIM_ACCESS_TOKEN, ZAIM_ACCESS_TOKEN_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import * as log from "../_utils/log.ts";
import { ZaimAPI } from "../../src/services/zaim/api.ts";
import { fetchZaimData } from "../../src/services/zaim/fetch_data.ts";
import {
  createZaimDbClient,
  syncMasters,
  syncTransactions,
  getExistingTransactionIds,
} from "../../src/services/zaim/write_db.ts";

async function checkApi(): Promise<void> {
  log.section("[1/3] API Connection");

  const api = new ZaimAPI();

  const user = await api.verifyUser();
  log.success(`Auth OK: user_id=${user.me.id}`);

  const categories = await api.getCategories();
  log.success(`Categories: ${categories.categories.length}`);

  const genres = await api.getGenres();
  log.success(`Genres: ${genres.genres.length}`);

  const accounts = await api.getAccounts();
  log.success(`Accounts: ${accounts.accounts.length}`);

  await api.getMoney({ limit: 1 });
  log.success(`Money fetch: OK`);
}

async function checkDb(): Promise<void> {
  log.section("[2/3] DB Status");

  const zaim = createZaimDbClient();

  const tables = ["categories", "genres", "accounts", "transactions"];
  for (const table of tables) {
    const { count } = await zaim
      .from(table)
      .select("*", { count: "exact", head: true });
    log.info(`${table}: ${count ?? 0}`);
  }
}

async function checkSync(): Promise<void> {
  log.section("[3/3] Sync Test (1 day)");
  log.warn("Writing to DB");

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startDate = yesterday.toISOString().split("T")[0];
  const endDate = today.toISOString().split("T")[0];

  const data = await fetchZaimData({ startDate, endDate });
  log.info(`Fetched: cat=${data.categories.length}, genre=${data.genres.length}, acc=${data.accounts.length}, tx=${data.transactions.length}`);

  const zaim = createZaimDbClient();

  await syncMasters(
    zaim,
    data.zaimUserId,
    data.categories,
    data.genres,
    data.accounts
  );
  log.success(`Masters synced`);

  const existingIds = await getExistingTransactionIds(
    zaim,
    data.zaimUserId,
    startDate,
    endDate
  );

  const txResult = await syncTransactions(
    zaim,
    data.zaimUserId,
    data.transactions,
    existingIds
  );
  log.success(`Transactions: new=${txResult.inserted}, updated=${txResult.updated}, skipped=${txResult.skipped}`);
}

async function main() {
  const includeSync = Deno.args.includes("--sync");

  log.header("Zaim Check", { syncMode: includeSync });

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
