/**
 * Fitbit - Sleep Sync
 *
 * Fetches sleep data from Fitbit API
 * and saves to raw.fitbit__sleep.
 */

import { setupLogger } from "../../lib/logger.js";
import { upsertRaw, type RawRecord } from "../../db/raw-client.js";
import {
  fetchSleep,
  fetchWithChunks,
  convertJstToUtc,
  CHUNK_LIMITS,
  type SleepLog,
} from "./api-client.js";

const logger = setupLogger("fitbit-sync-sleep");

const TABLE_NAME = "fitbit__sleep";
const API_VERSION = "v1.2";

/**
 * Convert API sleep log to raw record
 */
function toRawRecord(sleep: SleepLog): RawRecord {
  const sourceId = String(sleep.logId);

  return {
    sourceId,
    data: {
      log_id: sourceId,
      date: sleep.dateOfSleep,
      start_time: sleep.startTime,
      end_time: sleep.endTime,
      duration_ms: sleep.duration,
      efficiency: sleep.efficiency,
      is_main_sleep: sleep.isMainSleep,
      minutes_asleep: sleep.minutesAsleep,
      minutes_awake: sleep.minutesAwake,
      time_in_bed: sleep.timeInBed,
      sleep_type: sleep.type,
      levels: sleep.levels,
      _start_time_utc: convertJstToUtc(sleep.startTime),
      _end_time_utc: convertJstToUtc(sleep.endTime),
    },
  };
}

/**
 * Sync sleep data
 *
 * @param days - Number of days to sync (default 30)
 * @returns Number of records synced
 */
export async function syncSleep(days: number = 30): Promise<number> {
  logger.info(`Syncing sleep data (${days} days)...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Fetch with chunking for periods > 100 days
  const sleepLogs = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.sleep,
    fetchSleep
  );

  if (sleepLogs.length === 0) {
    logger.info("No sleep data to sync");
    return 0;
  }

  // Convert to raw records
  const records = sleepLogs.map(toRawRecord);

  // Upsert to database
  const result = await upsertRaw(TABLE_NAME, records, API_VERSION);

  logger.info(`Synced ${result.total} sleep records`);
  return result.total;
}
