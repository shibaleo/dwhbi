/**
 * Fitbit - Sync Orchestrator
 *
 * Coordinates sync of all Fitbit data types.
 * Runs sync sequentially to respect rate limits (150 req/hour).
 */

import { setupLogger } from "../../lib/logger.js";
import { getDbClient, closeDbClient } from "../../db/raw-client.js";
import { getAuthInfo } from "./api-client.js";
import { syncSleep } from "./sync-sleep.js";
import {
  syncActivity,
  syncActivityTimeSeries,
  syncHeartRate,
  syncHrv,
  syncSpo2,
  syncBreathingRate,
  syncCardioScore,
  syncTemperatureSkin,
} from "./sync-daily.js";

const logger = setupLogger("fitbit-orchestrator");

export interface SyncResult {
  sleepCount: number;
  activityCount: number;
  heartRateCount: number;
  hrvCount: number;
  spo2Count: number;
  breathingRateCount: number;
  cardioScoreCount: number;
  temperatureSkinCount: number;
  elapsedMs: number;
}

export interface SyncOptions {
  days?: number;
  fromDate?: Date;
  toDate?: Date;
  skipActivity?: boolean;
  onlyActivity?: boolean;
  useActivityTimeSeries?: boolean; // Use Time Series API for activity (~70% fewer API calls)
}

/**
 * Sync all Fitbit data
 *
 * Runs sync sequentially to respect rate limits.
 *
 * @param options - Sync options
 * @returns Sync result with counts and elapsed time
 */
export async function syncAll(options: SyncOptions = {}): Promise<SyncResult> {
  const { days = 30, fromDate, toDate, skipActivity = false, onlyActivity = false, useActivityTimeSeries = false } = options;

  // Determine date range
  let startDate: Date;
  let endDate: Date;

  if (fromDate && toDate) {
    startDate = fromDate;
    endDate = toDate;
    const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    logger.info(`Starting Fitbit sync (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}, ${dayCount} days)`);
  } else {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    logger.info(`Starting Fitbit sync (${days} days)`);
  }

  const startTime = Date.now();

  // Initialize DB connection
  await getDbClient();

  // Pre-fetch auth token to avoid concurrent refresh when using parallel requests
  await getAuthInfo();

  try {
    // Run syncs sequentially to respect rate limits (150 req/hour)
    let sleepCount = 0;
    let activityCount = 0;
    let heartRateCount = 0;
    let hrvCount = 0;
    let spo2Count = 0;
    let breathingRateCount = 0;
    let cardioScoreCount = 0;
    let temperatureSkinCount = 0;

    if (onlyActivity) {
      // Only sync activity data
      if (useActivityTimeSeries) {
        logger.info("Syncing activity only via Time Series API (--only-activity --activity-timeseries)...");
        activityCount = await syncActivityTimeSeries(startDate, endDate);
      } else {
        logger.info("Syncing activity only (--only-activity)...");
        activityCount = await syncActivity(startDate, endDate);
      }
    } else {
      // Normal sync flow
      logger.info("Step 1/8: Syncing sleep...");
      sleepCount = await syncSleep(startDate, endDate);

      if (skipActivity) {
        logger.info("Step 2/8: Skipping activity (--skip-activity)");
      } else if (useActivityTimeSeries) {
        logger.info("Step 2/8: Syncing activity via Time Series API (--activity-timeseries)...");
        activityCount = await syncActivityTimeSeries(startDate, endDate);
      } else {
        logger.info("Step 2/8: Syncing activity...");
        activityCount = await syncActivity(startDate, endDate);
      }

      logger.info("Step 3/8: Syncing heart rate...");
      heartRateCount = await syncHeartRate(startDate, endDate);

      logger.info("Step 4/8: Syncing HRV...");
      hrvCount = await syncHrv(startDate, endDate);

      logger.info("Step 5/8: Syncing SpO2...");
      spo2Count = await syncSpo2(startDate, endDate);

      logger.info("Step 6/8: Syncing breathing rate...");
      breathingRateCount = await syncBreathingRate(startDate, endDate);

      logger.info("Step 7/8: Syncing cardio score...");
      cardioScoreCount = await syncCardioScore(startDate, endDate);

      logger.info("Step 8/8: Syncing temperature skin...");
      temperatureSkinCount = await syncTemperatureSkin(startDate, endDate);
    }

    const elapsedMs = Date.now() - startTime;

    logger.info(
      `Fitbit sync completed in ${(elapsedMs / 1000).toFixed(2)}s`
    );

    return {
      sleepCount,
      activityCount,
      heartRateCount,
      hrvCount,
      spo2Count,
      breathingRateCount,
      cardioScoreCount,
      temperatureSkinCount,
      elapsedMs,
    };
  } finally {
    // Close DB connection
    await closeDbClient();
  }
}
