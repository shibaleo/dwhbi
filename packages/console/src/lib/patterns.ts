import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

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

export function calculateContentHash(entries: PatternEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.sortOrder - b.sortOrder);
  const content = sorted.map(e => `${e.projectId}|${e.startTime}|${e.memo || ""}`).join("\n");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Get all pattern groups with their current versions
 */
export async function getAllPatterns(): Promise<PatternInfo[]> {
  const supabase = await createClient();

  // Get all groups with their current versions (valid_to IS NULL)
  const { data: groups, error: groupsError } = await supabase
    .schema("console")
    .from("time_intent_pattern_groups")
    .select("id, name, description, created_at, updated_at")
    .is("deleted_at", null)
    .order("name");

  if (groupsError) {
    console.error("Failed to get pattern groups:", groupsError);
    return [];
  }

  // Get current versions for all groups
  const { data: versions, error: versionsError } = await supabase
    .schema("console")
    .from("time_intent_pattern_versions")
    .select("group_id, version_number, content_hash, valid_from, message, entries")
    .is("valid_to", null);

  if (versionsError) {
    console.error("Failed to get pattern versions:", versionsError);
  }

  type VersionRow = NonNullable<typeof versions>[number];
  const versionMap = new Map<string, VersionRow>();
  for (const v of versions || []) {
    versionMap.set(v.group_id, v);
  }

  return (groups || []).map(group => {
    const version = versionMap.get(group.id);
    let entries: PatternEntry[] = [];

    if (version?.entries) {
      if (Array.isArray(version.entries)) {
        entries = version.entries as PatternEntry[];
      } else if (typeof version.entries === "string") {
        try {
          const parsed = JSON.parse(version.entries);
          entries = Array.isArray(parsed) ? parsed : [];
        } catch {
          entries = [];
        }
      }
    }

    return {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.updated_at),
      },
      currentVersion: version ? {
        versionNumber: version.version_number,
        contentHash: version.content_hash,
        validFrom: new Date(version.valid_from),
        validTo: null,
        entryCount: entries.length,
        message: version.message || null,
      } : null,
      entries,
    };
  });
}

/**
 * Get a single pattern by group ID
 */
export async function getPattern(groupId: string): Promise<PatternInfo | null> {
  const supabase = await createClient();

  const { data: group, error: groupError } = await supabase
    .schema("console")
    .from("time_intent_pattern_groups")
    .select("id, name, description, created_at, updated_at")
    .eq("id", groupId)
    .single();

  if (groupError || !group) {
    return null;
  }

  const { data: version } = await supabase
    .schema("console")
    .from("time_intent_pattern_versions")
    .select("version_number, content_hash, valid_from, message, entries")
    .eq("group_id", groupId)
    .is("valid_to", null)
    .single();

  let entries: PatternEntry[] = [];
  if (version?.entries) {
    if (Array.isArray(version.entries)) {
      entries = version.entries as PatternEntry[];
    } else if (typeof version.entries === "string") {
      try {
        const parsed = JSON.parse(version.entries);
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        entries = [];
      }
    }
  }

  return {
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      createdAt: new Date(group.created_at),
      updatedAt: new Date(group.updated_at),
    },
    currentVersion: version ? {
      versionNumber: version.version_number,
      contentHash: version.content_hash,
      validFrom: new Date(version.valid_from),
      validTo: null,
      entryCount: entries.length,
      message: version.message || null,
    } : null,
    entries,
  };
}

/**
 * Get all Toggl projects for selection in UI
 */
export async function getAllProjects(): Promise<ProjectInfo[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .schema("staging")
    .from("stg_toggl_track__projects")
    .select("project_id, project_name, color")
    .eq("is_active", true)
    .order("project_name");

  if (error) {
    console.error("Failed to get projects:", error);
    return [];
  }

  return (rows || []).map(row => ({
    projectId: String(row.project_id),
    projectName: row.project_name,
    projectColor: row.color,
  }));
}

/**
 * Create a new pattern group
 */
export async function createPatternGroup(
  name: string,
  description?: string
): Promise<{ success: boolean; groupId?: string; error?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .from("time_intent_pattern_groups")
    .insert({ name, description: description || null })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, groupId: data.id };
}

/**
 * Update pattern group name/description
 */
export async function updatePatternGroup(
  groupId: string,
  name: string,
  description?: string | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .from("time_intent_pattern_groups")
    .update({ name, description: description ?? null, updated_at: new Date().toISOString() })
    .eq("id", groupId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
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
  const supabase = await createClient();

  try {
    const contentHash = calculateContentHash(entries);

    // Get pattern_type from group name
    const { data: group } = await supabase
      .schema("console")
      .from("time_intent_pattern_groups")
      .select("name")
      .eq("id", groupId)
      .single();

    // Close current version (set valid_to)
    await supabase
      .schema("console")
      .from("time_intent_pattern_versions")
      .update({ valid_to: new Date().toISOString() })
      .eq("group_id", groupId)
      .is("valid_to", null);

    // Insert new version
    const { error: insertError } = await supabase
      .schema("console")
      .from("time_intent_pattern_versions")
      .insert({
        group_id: groupId,
        pattern_type: group?.name || "",
        version_number: versionNumber,
        content_hash: contentHash,
        entries: entries,
        message: message || null,
      });

    if (insertError) {
      throw insertError;
    }

    return {
      groupId,
      versionNumber,
      entryCount: entries.length,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      groupId,
      versionNumber,
      entryCount: 0,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Get version history for a pattern group
 */
export async function getVersionHistory(groupId: string): Promise<PatternVersion[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .schema("console")
    .from("time_intent_pattern_versions")
    .select("version_number, content_hash, valid_from, valid_to, message, entries")
    .eq("group_id", groupId)
    .order("valid_from", { ascending: false });

  if (error) {
    console.error("Failed to get version history:", error);
    return [];
  }

  return (rows || []).map(row => {
    let entryCount = 0;
    if (Array.isArray(row.entries)) {
      entryCount = row.entries.length;
    } else if (typeof row.entries === "string") {
      try {
        const parsed = JSON.parse(row.entries);
        entryCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        entryCount = 0;
      }
    }

    return {
      versionNumber: row.version_number,
      contentHash: row.content_hash,
      validFrom: new Date(row.valid_from),
      validTo: row.valid_to ? new Date(row.valid_to) : null,
      entryCount,
      message: row.message || null,
    };
  });
}

/**
 * Get a specific version's entries
 */
export async function getVersionEntries(
  groupId: string,
  versionNumber: string
): Promise<PatternEntry[] | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .from("time_intent_pattern_versions")
    .select("entries")
    .eq("group_id", groupId)
    .eq("version_number", versionNumber)
    .single();

  if (error || !data) {
    return null;
  }

  if (Array.isArray(data.entries)) {
    return data.entries as PatternEntry[];
  } else if (typeof data.entries === "string") {
    try {
      const parsed = JSON.parse(data.entries);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Soft delete a pattern group (set deleted_at)
 */
export async function deletePatternGroup(
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .from("time_intent_pattern_groups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", groupId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
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
 *
 * Note: This requires joining multiple staging tables which may need
 * an RPC function if the join is too complex for the REST API.
 */
export async function getProjectGcalColorMappings(): Promise<Map<string, string>> {
  const supabase = await createClient();

  // Get project to color mappings from Coda
  const { data: projectMappings, error: pmError } = await supabase
    .schema("staging")
    .from("stg_coda__time_toggl_project_to_gcal_color")
    .select("toggl_project_name, gcal_color_row_id");

  if (pmError || !projectMappings) {
    console.error("Failed to get project mappings:", pmError);
    return new Map();
  }

  // Get color hex values
  const { data: codaColors, error: ccError } = await supabase
    .schema("staging")
    .from("stg_coda__mst_google_calendar_colors")
    .select("row_id, color_hex");

  if (ccError || !codaColors) {
    console.error("Failed to get coda colors:", ccError);
    return new Map();
  }

  // Get GCal color IDs
  const { data: gcalColors, error: gcError } = await supabase
    .schema("staging")
    .from("stg_google_calendar__colors")
    .select("color_id, background_color")
    .eq("color_kind", "event");

  if (gcError || !gcalColors) {
    console.error("Failed to get gcal colors:", gcError);
    return new Map();
  }

  // Build lookup maps
  const colorHexMap = new Map<string, string>();
  for (const c of codaColors) {
    colorHexMap.set(c.row_id, c.color_hex);
  }

  const gcalColorIdMap = new Map<string, string>();
  for (const g of gcalColors) {
    gcalColorIdMap.set(g.background_color, g.color_id);
  }

  // Build final mapping
  const mappings = new Map<string, string>();
  for (const pm of projectMappings) {
    const colorHex = colorHexMap.get(pm.gcal_color_row_id);
    if (colorHex) {
      const gcalColorId = gcalColorIdMap.get(colorHex);
      if (gcalColorId) {
        mappings.set(pm.toggl_project_name, gcalColorId);
      }
    }
  }

  return mappings;
}
