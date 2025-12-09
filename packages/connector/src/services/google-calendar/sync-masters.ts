/**
 * Google Calendar Master Data Sync
 *
 * Syncs colors, calendar_list, calendars.
 */

import { upsertRaw, RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import {
  fetchColors,
  fetchCalendarList,
  fetchCalendar,
  getAuthInfo,
} from "./api-client.js";

const logger = setupLogger("gcal-masters");

const API_VERSION = "v3";

// Types
export interface MasterSyncResult {
  success: boolean;
  counts: Record<string, number>;
  elapsedSeconds: number;
}

/**
 * Sync color palette
 *
 * Colors API returns event and calendar colors.
 * Each is saved as a separate record.
 */
async function syncColors(): Promise<number> {
  const data = await fetchColors();
  if (!data) return 0;

  const records: RawRecord[] = [];

  // Event colors
  if (data.event) {
    records.push({
      sourceId: "event",
      data: { kind: "event", colors: data.event },
    });
  }

  // Calendar colors
  if (data.calendar) {
    records.push({
      sourceId: "calendar",
      data: { kind: "calendar", colors: data.calendar },
    });
  }

  if (records.length === 0) return 0;

  const result = await upsertRaw("google_calendar__colors", records, API_VERSION);
  return result.total;
}

/**
 * Sync calendar list
 */
async function syncCalendarList(): Promise<number> {
  const data = await fetchCalendarList();
  if (data.length === 0) return 0;

  const records: RawRecord[] = data.map((item) => ({
    sourceId: item.id as string,
    data: item,
  }));

  const result = await upsertRaw(
    "google_calendar__calendar_list",
    records,
    API_VERSION
  );
  return result.total;
}

/**
 * Sync calendar metadata
 *
 * Fetches metadata for configured calendar_id.
 */
async function syncCalendars(): Promise<number> {
  const auth = await getAuthInfo();
  const calendarId = auth.calendarId;

  const data = await fetchCalendar(calendarId);
  if (!data || !data.id) return 0;

  const record: RawRecord = {
    sourceId: data.id as string,
    data,
  };

  const result = await upsertRaw("google_calendar__calendars", [record], API_VERSION);
  return result.total;
}

/**
 * Sync all master data in parallel
 */
export async function syncMasters(): Promise<MasterSyncResult> {
  const startTime = performance.now();
  logger.info("Starting Google Calendar masters sync");

  try {
    // Warm up auth cache to prevent duplicate refreshes
    await getAuthInfo();

    // Fetch and save all masters in parallel
    const results = await Promise.allSettled([
      syncColors(),
      syncCalendarList(),
      syncCalendars(),
    ]);

    const masterNames = ["colors", "calendar_list", "calendars"];
    const counts: Record<string, number> = {};
    const errors: string[] = [];

    for (let i = 0; i < masterNames.length; i++) {
      const name = masterNames[i];
      const result = results[i];

      if (result.status === "rejected") {
        logger.error(`Failed to sync ${name}: ${result.reason}`);
        errors.push(`${name}: ${result.reason}`);
        counts[name] = 0;
      } else {
        counts[name] = result.value;
      }
    }

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;

    // Log summary
    const countsStr = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    logger.info(`Google Calendar masters sync completed in ${elapsed}s: ${countsStr}`);

    if (errors.length > 0) {
      logger.warn(`Some masters failed: ${errors.join(", ")}`);
    }

    return {
      success: errors.length === 0,
      counts,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Google Calendar masters sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
