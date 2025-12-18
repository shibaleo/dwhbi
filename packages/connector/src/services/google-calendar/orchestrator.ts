/**
 * Google Calendar Orchestrator
 *
 * Unified entry point for full data sync.
 * Executes master sync first, then events.
 * Manages database connection lifecycle.
 */

import { setupLogger } from "../../lib/logger.js";
import { getDbClient, closeDbClient } from "../../db/raw-client.js";
import { syncEvents } from "./sync-events.js";
import { syncMasters } from "./sync-masters.js";

const logger = setupLogger("gcal-orchestrator");

// Types
export interface SyncAllResult {
  success: boolean;
  eventsCount: number;
  mastersCounts: Record<string, number>;
  elapsedSeconds: number;
}

export interface SyncOptions {
  days?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Sync all Google Calendar data
 *
 * Executes in order: masters -> events
 * Database connection is opened once and reused throughout.
 *
 * @param options - Sync options (days, startDate, endDate)
 * @returns Sync result
 */
export async function syncAll(options: SyncOptions = {}): Promise<SyncAllResult> {
  const { days = 3, startDate, endDate } = options;
  const startTime = performance.now();

  const rangeDesc = startDate && endDate
    ? `${startDate} to ${endDate}`
    : `${days} days`;
  logger.info(`Starting Google Calendar full sync (${rangeDesc})`);

  const errors: string[] = [];
  let eventsCount = 0;
  let mastersCounts: Record<string, number> = {};

  try {
    // Initialize shared DB connection
    await getDbClient();

    // 1. Masters sync (parallel internally)
    logger.info("Step 1: Syncing masters...");
    const mastersResult = await syncMasters();
    mastersCounts = mastersResult.counts;

    if (!mastersResult.success) {
      errors.push("masters: partial failure");
      logger.warn("Masters sync had partial failures, continuing with events...");
    }

    // 2. Events sync
    logger.info("Step 2: Syncing events...");
    const eventsResult = await syncEvents(days, startDate, endDate);
    eventsCount = eventsResult.count;

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;

    // Log summary
    const mastersStr = Object.entries(mastersCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    logger.info(
      `Google Calendar full sync completed in ${elapsed}s: ${mastersStr}, events=${eventsCount}`
    );

    if (errors.length > 0) {
      logger.warn(`Some syncs had issues: ${errors.join(", ")}`);
    }

    return {
      success: errors.length === 0,
      eventsCount,
      mastersCounts,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Google Calendar full sync failed after ${elapsed}s: ${error}`);
    throw error;
  } finally {
    // Always close DB connection
    await closeDbClient();
  }
}
