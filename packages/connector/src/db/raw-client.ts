/**
 * Raw layer database client
 *
 * Common UPSERT operations for raw.{service}__{endpoint} tables.
 * Uses direct PostgreSQL connection for execute_values equivalent.
 *
 * Connection management:
 * - Use getDbClient() / closeDbClient() for connection reuse within a sync session
 * - Orchestrator should call getDbClient() at start and closeDbClient() at end
 */

import pg from "pg";
import { config } from "dotenv";
import { setupLogger } from "../lib/logger.js";

// Load .env for local development
config();

const { Client } = pg;
const logger = setupLogger("raw-client");

// Singleton client for connection reuse
let sharedClient: pg.Client | null = null;
let clientConnected = false;

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
 * Get database URL from environment
 */
function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return databaseUrl;
}

/**
 * Get shared database client (singleton)
 *
 * Call this at the start of a sync session.
 * Remember to call closeDbClient() when done.
 *
 * @returns Connected pg.Client instance
 */
export async function getDbClient(): Promise<pg.Client> {
  if (sharedClient && clientConnected) {
    logger.debug("Reusing existing database connection");
    return sharedClient;
  }

  logger.debug("Creating new database connection...");
  sharedClient = new Client({ connectionString: getDatabaseUrl() });
  await sharedClient.connect();
  clientConnected = true;
  logger.info("Database connection established");

  return sharedClient;
}

/**
 * Close shared database client
 *
 * Call this at the end of a sync session.
 */
export async function closeDbClient(): Promise<void> {
  if (sharedClient && clientConnected) {
    await sharedClient.end();
    logger.info("Database connection closed");
  }
  sharedClient = null;
  clientConnected = false;
}

/**
 * Reset client state (for testing)
 */
export function resetDbClient(): void {
  sharedClient = null;
  clientConnected = false;
}

/**
 * UPSERT records to raw layer table
 *
 * Uses the shared database client (getDbClient).
 * If no client is initialized, creates a temporary connection.
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

  // Use shared client if available, otherwise create temporary
  const useShared = sharedClient && clientConnected;
  const client = useShared ? sharedClient! : new Client({ connectionString: getDatabaseUrl() });

  try {
    if (!useShared) {
      logger.debug(`Creating temporary connection for ${tableName}`);
      await client.connect();
    }

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
    // Only close if using temporary connection
    if (!useShared) {
      await client.end();
    }
  }
}

/**
 * Delete records by source_ids
 *
 * @param tableName - Table name without schema
 * @param sourceIds - Array of source_id values to delete
 * @param batchSize - Batch size for DELETE (default 1000)
 * @returns Number of deleted records
 */
export async function deleteBySourceIds(
  tableName: string,
  sourceIds: string[],
  batchSize: number = 1000
): Promise<number> {
  if (sourceIds.length === 0) {
    return 0;
  }

  const useShared = sharedClient && clientConnected;
  const client = useShared ? sharedClient! : new Client({ connectionString: getDatabaseUrl() });

  try {
    if (!useShared) {
      logger.debug(`Creating temporary connection for ${tableName} delete`);
      await client.connect();
    }

    let totalDeleted = 0;

    // Process in batches
    for (let i = 0; i < sourceIds.length; i += batchSize) {
      const batch = sourceIds.slice(i, i + batchSize);
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(", ");
      const sql = `DELETE FROM raw.${tableName} WHERE source_id IN (${placeholders})`;

      const result = await client.query(sql, batch);
      totalDeleted += result.rowCount ?? 0;
    }

    logger.info(`Deleted ${totalDeleted} records from raw.${tableName}`);
    return totalDeleted;
  } finally {
    if (!useShared) {
      await client.end();
    }
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
