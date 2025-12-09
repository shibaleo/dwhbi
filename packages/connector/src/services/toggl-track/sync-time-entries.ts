/**
 * Toggl Track Time Entries Sync (Track API v9)
 *
 * Daily sync - fetches time entries for specified days and saves to raw layer.
 * Includes running entries (duration < 0).
 */

import { upsertRaw, RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import { fetchTimeEntries } from "./api-client.js";

const logger = setupLogger("toggl-time-entries");

const TABLE_NAME = "toggl_track__time_entries";
const API_VERSION = "v9";

// Types
export interface SyncResult {
  success: boolean;
  count: number;
  elapsedSeconds: number;
}

/**
 * Convert API response to RawRecord
 */
function toRawRecord(entry: Record<string, unknown>): RawRecord {
  return {
    sourceId: String(entry.id),
    data: entry,
  };
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Sync time entries
 *
 * @param days - Number of days to sync (from today backwards)
 * @returns Sync result
 */
export async function syncTimeEntries(days: number = 3): Promise<SyncResult> {
  const startTime = performance.now();
  logger.info(`Starting Toggl time entries sync (${days} days)`);

  // Calculate date range (end_date is tomorrow to include today)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  try {
    // Fetch from API
    logger.info(`Fetching time entries (${startStr} to ${endStr})...`);
    const entries = await fetchTimeEntries(startStr, endStr);
    logger.info(`Fetched ${entries.length} time entries`);

    // Save to raw layer
    let count = 0;
    if (entries.length > 0) {
      const records = entries.map(toRawRecord);
      const result = await upsertRaw(TABLE_NAME, records, API_VERSION);
      count = result.total;
    }

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.info(`Toggl time entries sync completed: ${count} entries in ${elapsed}s`);

    return {
      success: true,
      count,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Toggl time entries sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
