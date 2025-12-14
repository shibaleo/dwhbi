/**
 * Coda Orchestrator
 *
 * Unified entry point for Coda data sync.
 * Syncs table rows from configured documents.
 * Manages database connection lifecycle.
 */

import { setupLogger } from "../../lib/logger.js";
import { getDbClient, closeDbClient } from "../../db/raw-client.js";
import { syncTableRows, type SyncResult } from "./sync-table-rows.js";

const logger = setupLogger("coda-orchestrator");

// Hardcoded target table
const TARGET_DOC_ID = "otJmZmksOC";
const TARGET_TABLE_ID = "grid-Wu3URkM3rF";

export interface SyncAllResult {
  success: boolean;
  tableResults: SyncResult[];
  totalRows: number;
  elapsedSeconds: number;
}

/**
 * Sync all Coda data
 *
 * Currently syncs only the target table (grid-Wu3URkM3rF)
 *
 * @returns Sync result
 */
export async function syncAll(): Promise<SyncAllResult> {
  const startTime = performance.now();
  logger.info("Starting Coda full sync");

  const tableResults: SyncResult[] = [];

  try {
    // Initialize shared DB connection
    await getDbClient();

    // Sync target table
    logger.info(`Syncing table ${TARGET_TABLE_ID} from doc ${TARGET_DOC_ID}...`);
    const result = await syncTableRows(TARGET_DOC_ID, TARGET_TABLE_ID);
    tableResults.push(result);

    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    const totalRows = tableResults.reduce((sum, r) => sum + r.total, 0);
    const hasErrors = tableResults.some((r) => !r.success);

    logger.info(
      `Coda full sync completed in ${elapsed}s: ${totalRows} rows synced`
    );

    if (hasErrors) {
      const failedTables = tableResults
        .filter((r) => !r.success)
        .map((r) => r.table);
      logger.warn(`Some tables failed to sync: ${failedTables.join(", ")}`);
    }

    return {
      success: !hasErrors,
      tableResults,
      totalRows,
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
    logger.error(`Coda full sync failed after ${elapsed}s: ${error}`);
    throw error;
  } finally {
    // Always close DB connection
    await closeDbClient();
  }
}
