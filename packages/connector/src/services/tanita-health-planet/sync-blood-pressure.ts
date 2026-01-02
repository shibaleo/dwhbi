/**
 * Tanita Health Planet - Blood Pressure Sync
 *
 * Fetches blood pressure data (systolic, diastolic, pulse) from Health Planet API
 * and saves to raw.tanita_health_planet__blood_pressure.
 */

import { setupLogger } from "../../lib/logger.js";
import { upsertRaw, type RawRecord } from "../../db/raw-client.js";
import {
  fetchSphygmomanometer,
  fetchWithChunks,
  parseTanitaResponseDate,
  toJstString,
  type BloodPressureMeasurement,
} from "./api-client.js";

const logger = setupLogger("tanita-sync-bp");

const TABLE_NAME = "tanita_health_planet__blood_pressure";
const API_VERSION = "v1";

/**
 * Convert API measurement to raw record
 */
function toRawRecord(measurement: BloodPressureMeasurement): RawRecord {
  const sourceId = parseTanitaResponseDate(measurement.date);

  return {
    sourceId,
    data: {
      date: measurement.date,
      keydata: measurement.keydata,
      model: measurement.model,
      tag: measurement.tag,
      systolic: measurement.systolic,
      diastolic: measurement.diastolic,
      pulse: measurement.pulse,
      _measured_at_jst: toJstString(measurement.date),
    },
  };
}

/**
 * Sync blood pressure data
 *
 * @param days - Number of days to sync (default 30)
 * @returns Number of records synced
 */
export async function syncBloodPressure(days: number = 30): Promise<number> {
  logger.info(`Syncing blood pressure data (${days} days)...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Fetch with chunking for periods > 90 days
  const measurements = await fetchWithChunks(
    startDate,
    endDate,
    fetchSphygmomanometer
  );

  if (measurements.length === 0) {
    logger.info("No blood pressure data to sync");
    return 0;
  }

  // Convert to raw records
  const records = measurements.map(toRawRecord);

  // Upsert to database
  const result = await upsertRaw(TABLE_NAME, records, API_VERSION);

  logger.info(`Synced ${result.total} blood pressure records`);
  return result.total;
}
