/**
 * Google Calendar Events Sync
 *
 * Daily sync - fetches events for specified days and saves to raw layer.
 * Handles pagination for >2500 events.
 */

import { upsertRawBatch, RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import { fetchEventsBatch } from "./api-client.js";

const logger = setupLogger("gcal-events");

const TABLE_NAME = "google_calendar__events";
const API_VERSION = "v3";

// Types
export interface SyncResult {
  success: boolean;
  count: number;
  elapsedSeconds: number;
}

/**
 * Convert API response to RawRecord
 *
 * source_id is {calendarId}:{eventId} format
 */
function toRawRecord(event: Record<string, unknown>): RawRecord {
  const calendarId = (event._calendar_id as string) || "primary";
  const eventId = event.id as string;
  const sourceId = `${calendarId}:${eventId}`;

  return {
    sourceId,
    data: event,
  };
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Sync events using Batch API
 *
 * Fetches events for the specified date range using batch requests.
 *
 * @param days - Number of days to sync
 * @param startDate - Optional start date (YYYY-MM-DD)
 * @param endDate - Optional end date (YYYY-MM-DD)
 * @returns Sync result
 */
export async function syncEvents(
  days: number = 3,
  startDate?: string,
  endDate?: string
): Promise<SyncResult> {
  const startTime = performance.now();

  // Determine date range
  let startD: Date;
  let endD: Date;

  if (startDate && endDate) {
    startD = new Date(startDate);
    endD = new Date(endDate);
  } else {
    endD = new Date();
    endD.setDate(endD.getDate() + 1);
    startD = new Date();
    startD.setDate(startD.getDate() - (days - 1));
  }

  const startStr = formatDate(startD);
  const endStr = formatDate(endD);

  logger.info(
    `Starting Google Calendar events sync (${startStr} to ${endStr})`
  );

  try {
    // Fetch all events using batch API
    const events = await fetchEventsBatch(startStr, endStr);
    logger.info(`Fetched ${events.length} events (may include duplicates)`);

    if (events.length === 0) {
      const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
      return {
        success: true,
        count: 0,
        elapsedSeconds: elapsed,
      };
    }

    // Deduplicate events by source_id (events spanning multiple days appear multiple times)
    const recordMap = new Map<string, RawRecord>();
    for (const event of events) {
      const record = toRawRecord(event);
      recordMap.set(record.sourceId, record);
    }
    const records = Array.from(recordMap.values());
    logger.info(`Deduplicated to ${records.length} unique events`);

    // Save to DB
    const result = await upsertRawBatch(TABLE_NAME, records, API_VERSION);

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.info(
      `Google Calendar events sync completed: ${result.total} events in ${elapsed}s`
    );

    return {
      success: true,
      count: result.total,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;

    // On rate limit, return partial result
    if (
      String(error).includes("429") ||
      String(error).includes("rateLimitExceeded")
    ) {
      logger.warn(`Google Calendar API rate limit after ${elapsed}s`);
      return {
        success: false,
        count: 0,
        elapsedSeconds: elapsed,
      };
    }

    logger.error(`Google Calendar events sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
