/**
 * Coda Master & Mapping Tables Sync
 *
 * Fetches master and mapping tables from Coda API and saves to raw schema.
 * Each table is stored in its own raw table (not in coda__table_rows).
 */

import { fetchTableRows, type CodaRow } from "./api-client.js";
import { upsertRaw, type RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";

const logger = setupLogger("coda-sync-masters");

// Coda doc ID
const CODA_DOC_ID = "otJmZmksOC";

// Table mappings: Coda table_id -> raw table name
const TABLE_MAPPINGS: Record<string, string> = {
  "grid-1a2cLMloN0": "coda__mst_personal_time_category",
  "grid-qqVwHqBfCz": "coda__mst_social_time_category",
  "grid-LxGswbLt-q": "coda__mst_toggl_projects",
  "grid-tx-SGor2xN": "coda__map_toggl_color_to_personal",
  "grid-CI5rehwM3k": "coda__map_toggl_client_to_social",
};

export interface MasterSyncResult {
  success: boolean;
  tables: TableSyncResult[];
  totalRows: number;
  elapsedSeconds: number;
}

export interface TableSyncResult {
  tableId: string;
  rawTable: string;
  total: number;
  success: boolean;
  error?: string;
}

/**
 * Convert Coda row to RawRecord format
 * Uses row_id as source_id (not composite key since tables are separated)
 */
function toRawRecord(row: CodaRow): RawRecord {
  return {
    sourceId: row.id,
    data: {
      row_id: row.id,
      name: row.name,
      index: row.index,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      browser_link: row.browserLink,
      values: row.values,
    },
  };
}

/**
 * Sync a single master/mapping table
 */
async function syncTable(
  tableId: string,
  rawTableName: string
): Promise<TableSyncResult> {
  logger.debug(`Syncing ${rawTableName} from Coda table ${tableId}...`);

  try {
    const rows = await fetchTableRows(CODA_DOC_ID, tableId);

    if (rows.length === 0) {
      logger.debug(`No rows found in table ${tableId}`);
      return { tableId, rawTable: rawTableName, total: 0, success: true };
    }

    const records = rows.map(toRawRecord);
    const result = await upsertRaw(rawTableName, records, "v1");

    logger.debug(`Synced ${result.total} rows to ${rawTableName}`);
    return { tableId, rawTable: rawTableName, total: result.total, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to sync ${rawTableName}: ${message}`);
    return { tableId, rawTable: rawTableName, total: 0, success: false, error: message };
  }
}

/**
 * Sync all master and mapping tables from Coda to raw schema
 */
export async function syncMasters(): Promise<MasterSyncResult> {
  const startTime = performance.now();
  logger.info("Starting Coda masters sync");

  const results: TableSyncResult[] = [];

  // Sync all tables sequentially (to avoid rate limits)
  for (const [tableId, rawTableName] of Object.entries(TABLE_MAPPINGS)) {
    const result = await syncTable(tableId, rawTableName);
    results.push(result);
  }

  const elapsed = Math.round((performance.now() - startTime) / 10) / 100;
  const totalRows = results.reduce((sum, r) => sum + r.total, 0);
  const hasErrors = results.some((r) => !r.success);

  // Log summary
  const summary = results.map((r) => `${r.rawTable}=${r.total}`).join(", ");
  logger.info(`Coda masters sync completed in ${elapsed}s: ${summary}`);

  if (hasErrors) {
    const failed = results.filter((r) => !r.success).map((r) => r.rawTable);
    logger.warn(`Some tables failed: ${failed.join(", ")}`);
  }

  return {
    success: !hasErrors,
    tables: results,
    totalRows,
    elapsedSeconds: elapsed,
  };
}
