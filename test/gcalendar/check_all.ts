// test/gcalendar/check_all.ts
// Google Calendar 全確認スクリプト一括実行
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/gcalendar/check_all.ts
//   deno run --allow-env --allow-net --allow-read test/gcalendar/check_all.ts --sync
//
// 必要な環境変数:
//   GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import * as log from "../_utils/log.ts";
import { getAccessToken, loadCredentials } from "../../src/services/gcalendar/auth.ts";
import { fetchEvents, getCalendarId } from "../../src/services/gcalendar/api.ts";
import { fetchEventsByDays } from "../../src/services/gcalendar/fetch_data.ts";
import { createGCalendarDbClient, upsertEvents } from "../../src/services/gcalendar/write_db.ts";

const TEST_DAYS = 1;

async function checkApi(): Promise<void> {
  log.section("[1/3] API Connection");

  const credentials = loadCredentials();
  log.success(`Service Account: ${log.mask(credentials.client_email)}`);

  const accessToken = await getAccessToken();
  log.success(`Token: ${accessToken.length} chars`);

  const calendarId = getCalendarId();
  log.success(`Calendar ID: ${log.mask(calendarId)}`);

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - TEST_DAYS);

  const events = await fetchEvents({
    calendarId,
    timeMin: startDate.toISOString(),
    timeMax: now.toISOString(),
  });
  log.success(`Events fetched: ${events.length}`);
}

async function checkDb(): Promise<void> {
  log.section("[2/3] DB Status");

  const gcalendar = createGCalendarDbClient();
  const { count } = await gcalendar
    .from("events")
    .select("*", { count: "exact", head: true });

  log.info(`events: ${count ?? 0}`);
}

async function checkSync(): Promise<void> {
  log.section(`[3/3] Sync Test (${TEST_DAYS} days)`);
  log.warn("Writing to DB");

  const { events, raw } = await fetchEventsByDays(TEST_DAYS);
  log.info(`Fetched: ${raw.length} -> Transformed: ${events.length}`);

  const gcalendar = createGCalendarDbClient();
  const result = await upsertEvents(gcalendar, events);
  log.success(`Upsert: ${result.success} success, ${result.failed} failed`);
}

async function main() {
  const includeSync = Deno.args.includes("--sync");

  log.header("Google Calendar Check", { syncMode: includeSync });

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
