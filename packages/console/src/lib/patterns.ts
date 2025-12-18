import postgres from "postgres";
import crypto from "crypto";

// Types
export interface PatternEntry {
  projectId: string;   // Toggl project ID (stable identifier)
  projectName: string; // Display name (may change)
  projectColor: string | null; // Hex color code (e.g., "#d94182")
  startTime: string;   // HH:MM:SS format
  sortOrder: number;
  memo: string | null;
}

export interface PatternGroup {
  id: string;          // UUID - stable identifier
  name: string;        // Display name (editable)
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatternVersion {
  versionNumber: string;
  contentHash: string;
  validFrom: Date;
  validTo: Date | null;
  entryCount: number;
  message: string | null;
}

export interface PatternInfo {
  group: PatternGroup;
  currentVersion: PatternVersion | null;
  entries: PatternEntry[];
}

export interface ApplyResult {
  groupId: string;
  versionNumber: string;
  entryCount: number;
  success: boolean;
  error?: string;
}

// Project info from staging table
export interface ProjectInfo {
  projectId: string;
  projectName: string;
  projectColor: string | null;
}

function getDbConnection() {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_DATABASE_URL is not set");
  }
  return postgres(connectionString);
}

export function calculateContentHash(entries: PatternEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.sortOrder - b.sortOrder);
  const content = sorted.map(e => `${e.projectId}|${e.startTime}|${e.memo || ""}`).join("\n");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Get all pattern groups with their current versions
 */
export async function getAllPatterns(): Promise<PatternInfo[]> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT
        g.id as group_id,
        g.name as group_name,
        g.description,
        g.created_at,
        g.updated_at,
        v.version_number,
        v.content_hash,
        v.valid_from,
        v.message,
        v.entries
      FROM console.time_intent_pattern_groups g
      LEFT JOIN console.time_intent_pattern_versions v
        ON g.id = v.group_id AND v.valid_to IS NULL
      WHERE g.deleted_at IS NULL
      ORDER BY g.name
    `;

    return rows.map(row => {
      // Handle case where postgres returns JSONB as string
      let entries: PatternEntry[] = [];
      if (Array.isArray(row.entries)) {
        entries = row.entries;
      } else if (typeof row.entries === "string") {
        try {
          const parsed = JSON.parse(row.entries);
          entries = Array.isArray(parsed) ? parsed : [];
        } catch {
          entries = [];
        }
      }
      return {
        group: {
          id: row.group_id,
          name: row.group_name,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        currentVersion: row.version_number ? {
          versionNumber: row.version_number,
          contentHash: row.content_hash,
          validFrom: row.valid_from,
          validTo: null,
          entryCount: entries.length,
          message: row.message || null,
        } : null,
        entries,
      };
    });
  } finally {
    await sql.end();
  }
}

/**
 * Get a single pattern by group ID
 */
export async function getPattern(groupId: string): Promise<PatternInfo | null> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT
        g.id as group_id,
        g.name as group_name,
        g.description,
        g.created_at,
        g.updated_at,
        v.version_number,
        v.content_hash,
        v.valid_from,
        v.message,
        v.entries
      FROM console.time_intent_pattern_groups g
      LEFT JOIN console.time_intent_pattern_versions v
        ON g.id = v.group_id AND v.valid_to IS NULL
      WHERE g.id = ${groupId}
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    // Handle case where postgres returns JSONB as string
    let entries: PatternEntry[] = [];
    if (Array.isArray(row.entries)) {
      entries = row.entries;
    } else if (typeof row.entries === "string") {
      try {
        const parsed = JSON.parse(row.entries);
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        entries = [];
      }
    }
    return {
      group: {
        id: row.group_id,
        name: row.group_name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      currentVersion: row.version_number ? {
        versionNumber: row.version_number,
        contentHash: row.content_hash,
        validFrom: row.valid_from,
        validTo: null,
        entryCount: entries.length,
        message: row.message || null,
      } : null,
      entries,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Get all Toggl projects for selection in UI
 */
export async function getAllProjects(): Promise<ProjectInfo[]> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT
        project_id,
        project_name,
        color as project_color
      FROM staging.stg_toggl_track__projects
      WHERE is_active = true
      ORDER BY project_name
    `;

    return rows.map(row => ({
      projectId: String(row.project_id),
      projectName: row.project_name,
      projectColor: row.project_color,
    }));
  } finally {
    await sql.end();
  }
}

/**
 * Create a new pattern group
 */
export async function createPatternGroup(
  name: string,
  description?: string
): Promise<{ success: boolean; groupId?: string; error?: string }> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      INSERT INTO console.time_intent_pattern_groups (name, description)
      VALUES (${name}, ${description || null})
      RETURNING id
    `;

    return {
      success: true,
      groupId: rows[0].id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Update pattern group name/description
 */
export async function updatePatternGroup(
  groupId: string,
  name: string,
  description?: string | null
): Promise<{ success: boolean; error?: string }> {
  const sql = getDbConnection();

  try {
    await sql`
      UPDATE console.time_intent_pattern_groups
      SET name = ${name}, description = ${description ?? null}, updated_at = now()
      WHERE id = ${groupId}
    `;

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Create a new version for a pattern group
 */
export async function createVersion(
  groupId: string,
  versionNumber: string,
  entries: PatternEntry[],
  message?: string
): Promise<ApplyResult> {
  const sql = getDbConnection();

  try {
    const contentHash = calculateContentHash(entries);

    await sql.begin(async (tx) => {
      // Close current version (set valid_to)
      await tx`
        UPDATE console.time_intent_pattern_versions
        SET valid_to = now()
        WHERE group_id = ${groupId} AND valid_to IS NULL
      `;

      // Insert new version
      await tx`
        INSERT INTO console.time_intent_pattern_versions
          (group_id, pattern_type, version_number, content_hash, entries, message)
        VALUES (
          ${groupId},
          (SELECT name FROM console.time_intent_pattern_groups WHERE id = ${groupId}),
          ${versionNumber},
          ${contentHash},
          ${JSON.stringify(entries)}::jsonb,
          ${message || null}
        )
      `;
    });

    return {
      groupId,
      versionNumber,
      entryCount: entries.length,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      groupId,
      versionNumber,
      entryCount: 0,
      success: false,
      error: message,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Get version history for a pattern group
 */
export async function getVersionHistory(groupId: string): Promise<PatternVersion[]> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT
        version_number,
        content_hash,
        valid_from,
        valid_to,
        message,
        jsonb_array_length(entries) as entry_count
      FROM console.time_intent_pattern_versions
      WHERE group_id = ${groupId}
      ORDER BY valid_from DESC
    `;

    return rows.map(row => ({
      versionNumber: row.version_number,
      contentHash: row.content_hash,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      entryCount: row.entry_count ?? 0,
      message: row.message || null,
    }));
  } finally {
    await sql.end();
  }
}

/**
 * Get a specific version's entries
 */
export async function getVersionEntries(
  groupId: string,
  versionNumber: string
): Promise<PatternEntry[] | null> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT entries
      FROM console.time_intent_pattern_versions
      WHERE group_id = ${groupId} AND version_number = ${versionNumber}
    `;

    if (rows.length === 0) {
      return null;
    }

    // Handle case where postgres returns JSONB as string
    const rawEntries = rows[0].entries;
    if (Array.isArray(rawEntries)) {
      return rawEntries;
    } else if (typeof rawEntries === "string") {
      try {
        const parsed = JSON.parse(rawEntries);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  } finally {
    await sql.end();
  }
}

/**
 * Soft delete a pattern group (set deleted_at)
 */
export async function deletePatternGroup(
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  const sql = getDbConnection();

  try {
    await sql`
      UPDATE console.time_intent_pattern_groups
      SET deleted_at = now()
      WHERE id = ${groupId}
    `;

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  } finally {
    await sql.end();
  }
}

// =============================================================================
// Google Calendar Color Mapping
// =============================================================================

export interface ProjectGcalColorMapping {
  projectName: string;
  gcalColorName: string;
  gcalColorId: string | null; // Google Calendar color ID (1-11), null if not found
}

/**
 * Get Google Calendar color ID for Toggl projects
 * Maps: Toggl project name -> Coda color name -> GCal color ID
 */
export async function getProjectGcalColorMappings(): Promise<Map<string, string>> {
  const sql = getDbConnection();

  try {
    // Join Coda mapping with Google Calendar colors to get color IDs
    // Google Calendar uses color IDs (1-11) mapped by background color hex
    const rows = await sql`
      SELECT
        pm.toggl_project_name,
        pm.gcal_color_name,
        cc.color_hex,
        gc.color_id as gcal_color_id
      FROM staging.stg_coda__time_toggl_project_to_gcal_color pm
      JOIN staging.stg_coda__mst_google_calendar_colors cc
        ON pm.gcal_color_row_id = cc.row_id
      LEFT JOIN staging.stg_google_calendar__colors gc
        ON gc.color_kind = 'event'
        AND gc.background_color = cc.color_hex
    `;

    const mappings = new Map<string, string>();
    for (const row of rows) {
      if (row.gcal_color_id) {
        mappings.set(row.toggl_project_name, row.gcal_color_id);
      }
    }

    return mappings;
  } finally {
    await sql.end();
  }
}
