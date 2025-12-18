/**
 * Time Intent Pattern Sync
 *
 * Syncs time intent patterns from Coda with version management.
 * Patterns are stored with content hash for change detection.
 * Version numbers are manually assigned via Console UI.
 */

import crypto from "crypto";
import { fetchTables, fetchTableRows, type CodaRow } from "./api-client.js";
import { getDbClient } from "../../db/raw-client.js";
import { setupLogger } from "../../lib/logger.js";

const logger = setupLogger("coda-sync-patterns");

// Coda doc ID
const CODA_DOC_ID = "otJmZmksOC";

// Pattern table prefix
const PATTERN_TABLE_PREFIX = "time_intent_pattern_";

// Types
export interface PatternEntry {
  projectName: string;
  startTime: string; // HH:MM:SS format
  sortOrder: number;
  memo: string | null;
}

export interface PatternInfo {
  patternType: string;
  tableId: string;
  entries: PatternEntry[];
  contentHash: string;
}

export interface CurrentVersion {
  patternType: string;
  versionNumber: string | null;
  contentHash: string | null;
  validFrom: Date | null;
  entryCount: number;
}

export interface PatternPreview {
  patternType: string;
  currentVersion: CurrentVersion | null;
  codaPattern: PatternInfo;
  hasChanges: boolean;
}

export interface ApplyResult {
  patternType: string;
  versionNumber: string;
  entryCount: number;
  success: boolean;
  error?: string;
}

/**
 * Extract pattern type from Coda table name
 * e.g., "time_intent_pattern_work_day_full" -> "work_day_full"
 */
function extractPatternType(tableName: string): string | null {
  if (!tableName.startsWith(PATTERN_TABLE_PREFIX)) {
    return null;
  }
  return tableName.slice(PATTERN_TABLE_PREFIX.length);
}

/**
 * Parse time from Coda format to HH:MM:SS
 * Input: "1899-12-30T05:30:00.000+09:00"
 * Output: "05:30:00"
 */
function parseTime(codaTime: string): string {
  const match = codaTime.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : "00:00:00";
}

/**
 * Convert Coda row to PatternEntry
 */
function toPatternEntry(row: CodaRow): PatternEntry {
  const values = row.values;

  // Column IDs (from Coda API)
  const projectCol = "c-Qwzr6bMMhb";
  const startAtCol = "c-DMYHiDPv_P";
  const sortOrderCol = "c--zIVpWloTM";
  const memoCol = "c-0C4dk3HjrO";

  const projectValue = values[projectCol] as { name?: string } | undefined;
  const startAtValue = values[startAtCol] as string | undefined;
  const sortOrderValue = values[sortOrderCol] as number | undefined;
  const memoValue = values[memoCol] as string | undefined;

  return {
    projectName: projectValue?.name || "",
    startTime: startAtValue ? parseTime(startAtValue) : "00:00:00",
    sortOrder: sortOrderValue || 0,
    memo: memoValue || null,
  };
}

/**
 * Calculate content hash for a pattern
 * Hash is based on sorted entries (project, time, memo)
 */
function calculateContentHash(entries: PatternEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.sortOrder - b.sortOrder);
  const content = sorted.map(e => `${e.projectName}|${e.startTime}|${e.memo || ""}`).join("\n");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Discover all time_intent_pattern_* tables from Coda
 */
export async function discoverPatternTables(): Promise<{ id: string; name: string; patternType: string }[]> {
  logger.debug("Discovering pattern tables from Coda...");

  const tables = await fetchTables(CODA_DOC_ID);
  const patternTables = tables
    .map(t => {
      const patternType = extractPatternType(t.name);
      return patternType ? { id: t.id, name: t.name, patternType } : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  logger.info(`Found ${patternTables.length} pattern tables: ${patternTables.map(t => t.patternType).join(", ")}`);
  return patternTables;
}

/**
 * Fetch pattern data from Coda
 */
export async function fetchPatternFromCoda(tableId: string, patternType: string): Promise<PatternInfo> {
  logger.debug(`Fetching pattern ${patternType} from Coda...`);

  const rows = await fetchTableRows(CODA_DOC_ID, tableId);
  const entries = rows.map(toPatternEntry).sort((a, b) => a.sortOrder - b.sortOrder);
  const contentHash = calculateContentHash(entries);

  logger.debug(`Fetched ${entries.length} entries for ${patternType} (hash: ${contentHash})`);

  return {
    patternType,
    tableId,
    entries,
    contentHash,
  };
}

/**
 * Get current version for a pattern type from DB
 */
export async function getCurrentVersion(patternType: string): Promise<CurrentVersion | null> {
  const client = await getDbClient();

  const result = await client.query(`
    SELECT
      v.version_number,
      v.content_hash,
      v.valid_from,
      COUNT(e.id) as entry_count
    FROM raw.coda__time_intent_pattern_versions v
    LEFT JOIN raw.coda__time_intent_pattern_entries e ON e.version_id = v.id
    WHERE v.pattern_type = $1 AND v.valid_to IS NULL
    GROUP BY v.id, v.version_number, v.content_hash, v.valid_from
  `, [patternType]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    patternType,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    validFrom: row.valid_from,
    entryCount: parseInt(row.entry_count, 10),
  };
}

/**
 * Get all current versions
 */
export async function getAllCurrentVersions(): Promise<CurrentVersion[]> {
  const client = await getDbClient();

  const result = await client.query(`
    SELECT
      v.pattern_type,
      v.version_number,
      v.content_hash,
      v.valid_from,
      COUNT(e.id) as entry_count
    FROM raw.coda__time_intent_pattern_versions v
    LEFT JOIN raw.coda__time_intent_pattern_entries e ON e.version_id = v.id
    WHERE v.valid_to IS NULL
    GROUP BY v.id, v.pattern_type, v.version_number, v.content_hash, v.valid_from
    ORDER BY v.pattern_type
  `);

  return result.rows.map(row => ({
    patternType: row.pattern_type,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    validFrom: row.valid_from,
    entryCount: parseInt(row.entry_count, 10),
  }));
}

/**
 * Preview changes for all patterns
 */
export async function previewAllPatterns(): Promise<PatternPreview[]> {
  logger.info("Previewing all pattern changes...");

  const tables = await discoverPatternTables();
  const previews: PatternPreview[] = [];

  for (const table of tables) {
    const codaPattern = await fetchPatternFromCoda(table.id, table.patternType);
    const currentVersion = await getCurrentVersion(table.patternType);

    const hasChanges = !currentVersion || currentVersion.contentHash !== codaPattern.contentHash;

    previews.push({
      patternType: table.patternType,
      currentVersion,
      codaPattern,
      hasChanges,
    });
  }

  return previews;
}

/**
 * Apply a new version for a pattern
 *
 * @param patternType - Pattern type (e.g., "work_day_full")
 * @param versionNumber - New version number (e.g., "v1.0")
 * @param codaPattern - Pattern data from Coda (optional, will fetch if not provided)
 */
export async function applyVersion(
  patternType: string,
  versionNumber: string,
  codaPattern?: PatternInfo
): Promise<ApplyResult> {
  logger.info(`Applying version ${versionNumber} for pattern ${patternType}...`);

  const client = await getDbClient();

  try {
    // Fetch pattern if not provided
    if (!codaPattern) {
      const tables = await discoverPatternTables();
      const table = tables.find(t => t.patternType === patternType);
      if (!table) {
        throw new Error(`Pattern type not found: ${patternType}`);
      }
      codaPattern = await fetchPatternFromCoda(table.id, patternType);
    }

    // Start transaction
    await client.query("BEGIN");

    // Close current version (set valid_to)
    await client.query(`
      UPDATE raw.coda__time_intent_pattern_versions
      SET valid_to = now()
      WHERE pattern_type = $1 AND valid_to IS NULL
    `, [patternType]);

    // Insert new version
    const versionResult = await client.query(`
      INSERT INTO raw.coda__time_intent_pattern_versions
        (pattern_type, version_number, content_hash)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [patternType, versionNumber, codaPattern.contentHash]);

    const versionId = versionResult.rows[0].id;

    // Insert entries
    for (const entry of codaPattern.entries) {
      await client.query(`
        INSERT INTO raw.coda__time_intent_pattern_entries
          (version_id, project_name, start_time, sort_order, memo)
        VALUES ($1, $2, $3, $4, $5)
      `, [versionId, entry.projectName, entry.startTime, entry.sortOrder, entry.memo]);
    }

    await client.query("COMMIT");

    logger.info(`Applied version ${versionNumber} with ${codaPattern.entries.length} entries`);

    return {
      patternType,
      versionNumber,
      entryCount: codaPattern.entries.length,
      success: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to apply version: ${message}`);

    return {
      patternType,
      versionNumber,
      entryCount: 0,
      success: false,
      error: message,
    };
  }
}

/**
 * Get version history for a pattern
 */
export async function getVersionHistory(patternType: string): Promise<Array<{
  versionNumber: string;
  contentHash: string;
  validFrom: Date;
  validTo: Date | null;
  entryCount: number;
}>> {
  const client = await getDbClient();

  const result = await client.query(`
    SELECT
      v.version_number,
      v.content_hash,
      v.valid_from,
      v.valid_to,
      COUNT(e.id) as entry_count
    FROM raw.coda__time_intent_pattern_versions v
    LEFT JOIN raw.coda__time_intent_pattern_entries e ON e.version_id = v.id
    WHERE v.pattern_type = $1
    GROUP BY v.id, v.version_number, v.content_hash, v.valid_from, v.valid_to
    ORDER BY v.valid_from DESC
  `, [patternType]);

  return result.rows.map(row => ({
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    entryCount: parseInt(row.entry_count, 10),
  }));
}
