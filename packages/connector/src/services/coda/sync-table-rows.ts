/**
 * Coda Table Rows Sync
 *
 * Fetches table rows from Coda API and saves to raw.coda__table_rows
 */

import { fetchTableRows, type CodaRow } from "./api-client.js";
import { upsertRaw, type RawRecord } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";

const logger = setupLogger("coda-sync");

export interface SyncResult {
  table: string;
  total: number;
  success: boolean;
  error?: string;
}

/**
 * Convert Coda row to RawRecord format
 */
function toRawRecord(docId: string, tableId: string, row: CodaRow): RawRecord {
  return {
    // Unique key: doc_id:table_id:row_id
    sourceId: `${docId}:${tableId}:${row.id}`,
    data: {
      doc_id: docId,
      table_id: tableId,
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
 * Sync a single table's rows
 */
export async function syncTableRows(
  docId: string,
  tableId: string
): Promise<SyncResult> {
  logger.info(`Syncing table ${tableId} from doc ${docId}...`);

  try {
    const rows = await fetchTableRows(docId, tableId);

    if (rows.length === 0) {
      logger.info(`No rows found in table ${tableId}`);
      return { table: tableId, total: 0, success: true };
    }

    const records = rows.map((row) => toRawRecord(docId, tableId, row));
    const result = await upsertRaw("coda__table_rows", records, "v1");

    logger.info(`Synced ${result.total} rows from table ${tableId}`);
    return { table: tableId, total: result.total, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to sync table ${tableId}: ${message}`);
    return { table: tableId, total: 0, success: false, error: message };
  }
}

/**
 * Sync specific table by ID
 */
export async function syncSpecificTable(
  docId: string,
  tableId: string
): Promise<SyncResult> {
  return syncTableRows(docId, tableId);
}
