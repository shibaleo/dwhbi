/**
 * Tanita Health Planet - Body Composition Sync
 *
 * Fetches body composition data (weight, body fat %) from Health Planet API
 * and saves to raw.tanita_health_planet__body_composition.
 */

import { setupLogger } from "../../lib/logger.js";
import { upsertRaw, type RawRecord } from "../../db/raw-client.js";
import {
  fetchInnerScan,
  fetchWithChunks,
  parseTanitaResponseDate,
  toJstString,
  type BodyCompositionMeasurement,
} from "./api-client.js";

const logger = setupLogger("tanita-sync-body");

const TABLE_NAME = "tanita_health_planet__body_composition";
const API_VERSION = "v1";

/**
 * Convert API measurement to raw record
 */
function toRawRecord(measurement: BodyCompositionMeasurement): RawRecord {
  const sourceId = parseTanitaResponseDate(measurement.date);

  return {
    sourceId,
    data: {
      date: measurement.date,
      keydata: measurement.keydata,
      model: measurement.model,
      tag: measurement.tag,
      weight: measurement.weight,
      body_fat_percent: measurement.bodyFatPercent,
      _measured_at_jst: toJstString(measurement.date),
    },
  };
}

/**
 * Sync body composition data
 *
 * @param days - Number of days to sync (default 30)
 * @returns Number of records synced
 */
export async function syncBodyComposition(days: number = 30): Promise<number> {
  logger.info(`Syncing body composition data (${days} days)...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Fetch with chunking for periods > 90 days
  const measurements = await fetchWithChunks(
    startDate,
    endDate,
    fetchInnerScan
  );

  if (measurements.length === 0) {
    logger.info("No body composition data to sync");
    return 0;
  }

  // Convert to raw records
  const records = measurements.map(toRawRecord);

  // Upsert to database
  const result = await upsertRaw(TABLE_NAME, records, API_VERSION);

  logger.info(`Synced ${result.total} body composition records`);
  return result.total;
}
