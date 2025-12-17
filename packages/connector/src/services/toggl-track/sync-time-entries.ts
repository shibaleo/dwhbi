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

export interface SyncOptions {
  /** Number of days to sync (from today backwards). Ignored if start is provided. */
  days?: number;
  /** Start date (YYYY-MM-DD). If provided, days is ignored. */
  start?: string;
  /** End date (YYYY-MM-DD). Defaults to tomorrow. */
  end?: string;
}

/**
 * Sync time entries
 *
 * @param options - Sync options (days, start, end)
 * @returns Sync result
 */
export async function syncTimeEntries(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = performance.now();

  // Calculate date range
  let startDate: Date;
  let endDate: Date;

  if (options.start) {
    // Use explicit start date
    startDate = new Date(options.start);
    if (options.end) {
      endDate = new Date(options.end);
    } else {
      // Default end = tomorrow
      endDate = new Date();
      endDate.setDate(endDate.getDate() + 1);
    }
    logger.info(`Starting Toggl time entries sync (${options.start} to ${formatDate(endDate)})`);
  } else {
    // Use days (backwards from today)
    const days = options.days ?? 3;
    endDate = new Date();
    endDate.setDate(endDate.getDate() + 1); // Include today
    startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    logger.info(`Starting Toggl time entries sync (${days} days)`);
  }

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
