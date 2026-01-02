/**
 * Tanita Health Planet - Sync Orchestrator
 *
 * Coordinates sync of all Tanita Health Planet data types.
 * Runs body composition and blood pressure sync in parallel.
 */

import { setupLogger } from "../../lib/logger.js";
import { getDbClient, closeDbClient } from "../../db/raw-client.js";
import { syncBodyComposition } from "./sync-body-composition.js";
import { syncBloodPressure } from "./sync-blood-pressure.js";

const logger = setupLogger("tanita-orchestrator");

export interface SyncResult {
  bodyCompositionCount: number;
  bloodPressureCount: number;
  elapsedMs: number;
}

export interface SyncOptions {
  days?: number;
}

/**
 * Sync all Tanita Health Planet data
 *
 * Runs body composition and blood pressure sync in parallel.
 *
 * @param options - Sync options
 * @returns Sync result with counts and elapsed time
 */
export async function syncAll(options: SyncOptions = {}): Promise<SyncResult> {
  const { days = 30 } = options;

  logger.info(`Starting Tanita Health Planet sync (${days} days)`);
  const startTime = Date.now();

  // Initialize DB connection
  await getDbClient();

  try {
    // Run body composition and blood pressure sync in parallel
    const [bodyCompositionCount, bloodPressureCount] = await Promise.all([
      syncBodyComposition(days),
      syncBloodPressure(days),
    ]);

    const elapsedMs = Date.now() - startTime;

    logger.info(
      `Tanita Health Planet sync completed in ${(elapsedMs / 1000).toFixed(2)}s`
    );

    return {
      bodyCompositionCount,
      bloodPressureCount,
      elapsedMs,
    };
  } finally {
    // Close DB connection
    await closeDbClient();
  }
}
