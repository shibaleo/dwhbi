/**
 * Toggl Track Orchestrator
 *
 * Unified entry point for full data sync.
 * Executes master sync first, then time entries.
 */

import { setupLogger } from "../../lib/logger.js";
import { syncTimeEntries } from "./sync-time-entries.js";
import { syncMasters } from "./sync-masters.js";

const logger = setupLogger("toggl-orchestrator");

// Types
export interface SyncAllResult {
  success: boolean;
  timeEntriesCount: number;
  mastersCounts: Record<string, number>;
  elapsedSeconds: number;
}

/**
 * Sync all Toggl Track data
 *
 * Executes in order: masters -> time entries
 *
 * @param days - Number of days for time entries
 * @returns Sync result
 */
export async function syncAll(days: number = 3): Promise<SyncAllResult> {
  const startTime = performance.now();
  logger.info(`Starting Toggl Track full sync (${days} days)`);

  const errors: string[] = [];
  let timeEntriesCount = 0;
  let mastersCounts: Record<string, number> = {};

  try {
    // 1. Masters sync (parallel internally)
    logger.info("Step 1: Syncing masters...");
    const mastersResult = await syncMasters();
    mastersCounts = mastersResult.counts;

    if (!mastersResult.success) {
      errors.push("masters: partial failure");
      logger.warn("Masters sync had partial failures, continuing with time entries...");
    }

    // 2. Time entries sync
    logger.info("Step 2: Syncing time entries...");
    const entriesResult = await syncTimeEntries(days);
    timeEntriesCount = entriesResult.count;

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;

    // Log summary
    const mastersStr = Object.entries(mastersCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    logger.info(
      `Toggl Track full sync completed in ${elapsed}s: ${mastersStr}, time_entries=${timeEntriesCount}`
    );

    if (errors.length > 0) {
      logger.warn(`Some syncs had issues: ${errors.join(", ")}`);
    }

    return {
      success: errors.length === 0,
      timeEntriesCount,
      mastersCounts,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Toggl Track full sync failed after ${elapsed}s: ${error}`);
    throw error;
  }
}
