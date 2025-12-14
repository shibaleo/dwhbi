/**
 * Toggl Track Time Entries Sync (Reports API v3)
 *
 * Historical sync - fetches detailed report for specified date range.
 * Features:
 *   - Auto-splits ranges > 1 year into yearly chunks
 *   - Batch DB saves (1000 records per batch)
 *   - Handles 429 (rate limit) and 402 (quota exceeded) via api-client
 */

import { upsertRawBatch, RawRecord, getDbClient, closeDbClient } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";
import { fetchAllDetailedReport } from "./api-client.js";

const logger = setupLogger("toggl-time-entries-report");

const TABLE_NAME = "toggl_track__time_entries_report";
const API_VERSION = "v3";
const MAX_DAYS_PER_CHUNK = 365;
const DB_BATCH_SIZE = 1000;

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
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Generate date chunks for ranges longer than MAX_DAYS_PER_CHUNK
 * Chunks are ordered from most recent to oldest (current -> past)
 */
function generateDateChunks(
  startDate: Date,
  endDate: Date
): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let currentEnd = new Date(endDate);

  while (currentEnd > startDate) {
    // Start of this chunk is either MAX_DAYS_PER_CHUNK before or startDate
    const chunkStart = new Date(
      Math.max(addDays(currentEnd, -MAX_DAYS_PER_CHUNK).getTime(), startDate.getTime())
    );

    chunks.push({
      start: formatDate(chunkStart),
      end: formatDate(currentEnd),
    });

    // Next chunk ends at chunkStart
    currentEnd = chunkStart;
  }

  return chunks;
}

/**
 * Sync time entries from Reports API v3
 *
 * @param days - Number of days to sync (from today backwards)
 * @returns Sync result
 */
export async function syncTimeEntriesReport(days: number = 365): Promise<SyncResult> {
  const startTime = performance.now();
  logger.info(`Starting Toggl time entries report sync (${days} days)`);

  // Calculate date range
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1); // Include today

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Generate chunks if range > 1 year
  const chunks = generateDateChunks(startDate, endDate);
  logger.info(`Date range split into ${chunks.length} chunk(s)`);

  try {
    let totalCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.info(`Processing chunk ${i + 1}/${chunks.length}: ${chunk.start} to ${chunk.end}`);

      // Fetch from API (handles pagination internally)
      const entries = await fetchAllDetailedReport(chunk.start, chunk.end);
      logger.info(`Fetched ${entries.length} entries for chunk`);

      if (entries.length > 0) {
        // Convert to RawRecords and deduplicate by sourceId
        // (API may return duplicates within same response)
        const recordMap = new Map<string, RawRecord>();
        for (const entry of entries) {
          const record = toRawRecord(entry);
          recordMap.set(record.sourceId, record);
        }
        const records = Array.from(recordMap.values());

        if (records.length !== entries.length) {
          logger.warn(`Deduplicated ${entries.length - records.length} duplicate entries`);
        }

        // Open DB connection fresh for each chunk to avoid timeout
        // (Supabase connection pooler may close idle connections)
        try {
          await getDbClient();
          const result = await upsertRawBatch(TABLE_NAME, records, API_VERSION, DB_BATCH_SIZE);
          totalCount += result.total;
          logger.info(`Saved ${result.total} records to DB`);
        } finally {
          await closeDbClient();
        }
      }
    }

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.info(`Toggl time entries report sync completed: ${totalCount} entries in ${elapsed}s`);

    return {
      success: true,
      count: totalCount,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Toggl time entries report sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
