/**
 * Raw layer database client
 *
 * Common UPSERT operations for raw.{service}__{endpoint} tables.
 * Uses direct PostgreSQL connection for execute_values equivalent.
 */

import pg from "pg";
import { config } from "dotenv";
import { setupLogger } from "../lib/logger.js";

// Load .env for local development
config();

const { Client } = pg;
const logger = setupLogger("raw-client");

// Types
export interface UpsertResult {
  table: string;
  inserted: number;
  updated: number;
  total: number;
}

export interface RawRecord {
  sourceId: string;
  data: Record<string, unknown>;
}

/**
 * Get direct database connection
 */
function getDbConnection(): pg.Client {
  const databaseUrl = process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DIRECT_DATABASE_URL environment variable is required");
  }
  return new Client({ connectionString: databaseUrl });
}

/**
 * UPSERT records to raw layer table
 *
 * @param tableName - Table name without schema (e.g., "toggl_track__time_entries")
 * @param records - Records with sourceId and data
 * @param apiVersion - Optional API version
 * @returns UPSERT result
 */
export async function upsertRaw(
  tableName: string,
  records: RawRecord[],
  apiVersion?: string
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { table: tableName, inserted: 0, updated: 0, total: 0 };
  }

  const client = getDbConnection();

  try {
    await client.connect();

    const now = new Date().toISOString();

    // Build VALUES for batch insert
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const record of records) {
      placeholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`
      );
      values.push(
        String(record.sourceId),
        JSON.stringify(record.data),
        now,
        apiVersion ?? null
      );
      paramIndex += 4;
    }

    // UPSERT with ON CONFLICT
    const sql = `
      INSERT INTO raw.${tableName} (source_id, data, synced_at, api_version)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (source_id) DO UPDATE SET
        data = EXCLUDED.data,
        synced_at = EXCLUDED.synced_at,
        api_version = COALESCE(EXCLUDED.api_version, raw.${tableName}.api_version)
    `;

    await client.query(sql, values);
    logger.info(`Upserted ${records.length} records to raw.${tableName}`);

    return {
      table: tableName,
      inserted: records.length,
      updated: 0,
      total: records.length,
    };
  } finally {
    await client.end();
  }
}

/**
 * UPSERT large batch of records (splits into batches)
 *
 * @param tableName - Table name
 * @param records - Records to upsert
 * @param apiVersion - Optional API version
 * @param batchSize - Batch size (default 1000)
 * @returns UPSERT result
 */
export async function upsertRawBatch(
  tableName: string,
  records: RawRecord[],
  apiVersion?: string,
  batchSize: number = 1000
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { table: tableName, inserted: 0, updated: 0, total: 0 };
  }

  let totalCount = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const result = await upsertRaw(tableName, batch, apiVersion);
    totalCount += result.total;
  }

  return {
    table: tableName,
    inserted: totalCount,
    updated: 0,
    total: totalCount,
  };
}
