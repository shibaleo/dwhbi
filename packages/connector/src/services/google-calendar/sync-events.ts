/**
 * Google Calendar Events Sync
 *
 * Daily sync - fetches events for specified days and saves to raw layer.
 * Handles pagination for >2500 events.
 */

import { upsertRawBatch, RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import { fetchEvents } from "./api-client.js";

const logger = setupLogger("gcal-events");

const TABLE_NAME = "google_calendar__events";
const API_VERSION = "v3";
const MAX_EVENTS_PER_CHUNK = 2500;

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
 * Sync events
 *
 * Fetches from end to start, handling pagination.
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

  logger.info(
    `Starting Google Calendar events sync (${formatDate(startD)} to ${formatDate(endD)})`
  );

  let totalCount = 0;
  let currentEnd = endD;
  let chunkNum = 0;

  while (currentEnd > startD) {
    chunkNum++;
    const chunkStartStr = formatDate(startD);
    const chunkEndStr = formatDate(currentEnd);

    logger.info(`Fetching chunk ${chunkNum}: ${chunkStartStr} to ${chunkEndStr}`);

    try {
      // Fetch from API (pagination handled internally)
      const events = await fetchEvents(chunkStartStr, chunkEndStr);
      logger.info(`Fetched ${events.length} events`);

      if (events.length === 0) {
        break;
      }

      // Save to DB
      const records = events.map(toRawRecord);
      const result = await upsertRawBatch(TABLE_NAME, records, API_VERSION);
      totalCount += result.total;
      logger.info(`Saved ${result.total} events to DB (total: ${totalCount})`);

      // If less than max, we got all events
      if (events.length < MAX_EVENTS_PER_CHUNK) {
        break;
      }

      // Find oldest event for next chunk
      const oldestEvent = events.reduce((oldest, event) => {
        const eventStart = event.start as Record<string, string> | undefined;
        const currentStart = oldest.start as Record<string, string> | undefined;

        const eventDate = eventStart?.dateTime || eventStart?.date || "";
        const currentDate = currentStart?.dateTime || currentStart?.date || "";

        return eventDate < currentDate ? event : oldest;
      });

      const oldestStart = oldestEvent.start as Record<string, string> | undefined;
      const oldestDateStr = oldestStart?.dateTime || oldestStart?.date;

      if (oldestDateStr) {
        currentEnd = new Date(oldestDateStr.slice(0, 10));
      } else {
        break;
      }
    } catch (error) {
      const elapsed = Math.round((performance.now() - startTime) / 10) / 100;

      // On rate limit, return what we have
      if (
        String(error).includes("429") ||
        String(error).includes("rateLimitExceeded")
      ) {
        logger.warn(
          `Google Calendar API rate limit. Saved ${totalCount} events before limit.`
        );
        return {
          success: totalCount > 0,
          count: totalCount,
          elapsedSeconds: elapsed,
        };
      }

      logger.error(`Google Calendar events sync failed after ${elapsed}s: ${error}`);
      throw error;
    }
  }

  const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
  logger.info(
    `Google Calendar events sync completed: ${totalCount} events in ${elapsed}s`
  );

  return {
    success: true,
    count: totalCount,
    elapsedSeconds: elapsed,
  };
}
