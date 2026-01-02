/**
 * Fitbit - Sync Orchestrator
 *
 * Coordinates sync of all Fitbit data types.
 * Runs sync sequentially to respect rate limits (150 req/hour).
 */

import { setupLogger } from "../../lib/logger.js";
import { getDbClient, closeDbClient } from "../../db/raw-client.js";
import { syncSleep } from "./sync-sleep.js";
import {
  syncActivity,
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
  const { days = 30 } = options;

  logger.info(`Starting Fitbit sync (${days} days)`);
  const startTime = Date.now();

  // Initialize DB connection
  await getDbClient();

  try {
    // Run syncs sequentially to respect rate limits (150 req/hour)
    logger.info("Step 1/8: Syncing sleep...");
    const sleepCount = await syncSleep(days);

    logger.info("Step 2/8: Syncing activity...");
    const activityCount = await syncActivity(days);

    logger.info("Step 3/8: Syncing heart rate...");
    const heartRateCount = await syncHeartRate(days);

    logger.info("Step 4/8: Syncing HRV...");
    const hrvCount = await syncHrv(days);

    logger.info("Step 5/8: Syncing SpO2...");
    const spo2Count = await syncSpo2(days);

    logger.info("Step 6/8: Syncing breathing rate...");
    const breathingRateCount = await syncBreathingRate(days);

    logger.info("Step 7/8: Syncing cardio score...");
    const cardioScoreCount = await syncCardioScore(days);

    logger.info("Step 8/8: Syncing temperature skin...");
    const temperatureSkinCount = await syncTemperatureSkin(days);

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
