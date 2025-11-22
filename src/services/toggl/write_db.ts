// write_db.ts - Supabase togglスキーマへの書き込み

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
  DbClient,
  DbProject,
  DbTag,
  DbEntry,
} from "./types.ts";

// --- Supabase client ---

export type TogglSchema = ReturnType<SupabaseClient["schema"]>;

/**
 * togglスキーマ専用のSupabaseクライアントを作成
 */
export function createTogglClient(): TogglSchema {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("toggl");
}

// --- Transformation functions ---

/**
 * API Client → DB Client
 */
export function toDbClient(client: TogglApiV9Client): DbClient {
  return {
    id: client.id,
    workspace_id: client.wid,
    name: client.name,
    is_archived: client.archived,
    created_at: client.at,
  };
}

/**
 * API Project → DB Project
 */
export function toDbProject(project: TogglApiV9Project): DbProject {
  return {
    id: project.id,
    workspace_id: project.workspace_id,
    client_id: project.client_id ?? null,
    name: project.name,
    color: project.color ?? null,
    is_private: project.is_private,
    is_active: project.active,
    is_billable: project.billable ?? false,
    created_at: project.created_at,
    archived_at: project.server_deleted_at ?? null,
    estimated_hours: project.estimated_hours ?? null,
    estimated_seconds: project.estimated_seconds ?? null,
    rate: project.rate ?? null,
    rate_last_updated: project.rate_last_updated ?? null,
    currency: project.currency ?? null,
    is_template: project.template ?? false,
    template_id: project.template_id ?? null,
    auto_estimates: project.auto_estimates ?? null,
    recurring: project.recurring ?? false,
    recurring_parameters: project.recurring_parameters ?? null,
    fixed_fee: project.fixed_fee ?? null,
    can_track_time: project.can_track_time ?? true,
    start_date: project.start_date ?? null,
  };
}

/**
 * API Tag → DB Tag
 */
export function toDbTag(tag: TogglApiV9Tag): DbTag {
  return {
    id: tag.id,
    workspace_id: tag.workspace_id,
    name: tag.name,
    created_at: tag.at,
  };
}

/**
 * API Time Entry → DB Entry
 * @returns null if entry is still running (negative duration)
 */
export function toDbEntry(entry: TogglApiV9TimeEntry): DbEntry | null {
  // 実行中エントリー（duration < 0）はスキップ
  if (entry.duration < 0) {
    return null;
  }

  return {
    id: entry.id,
    workspace_id: entry.workspace_id,
    project_id: entry.project_id ?? null,
    task_id: entry.task_id ?? null,
    user_id: entry.user_id,
    description: entry.description ?? null,
    start: entry.start,
    end: entry.stop ?? entry.start, // stopがない場合はstartと同じ
    duration_ms: entry.duration * 1000, // 秒 → ミリ秒
    is_billable: entry.billable,
    billable_amount: null, // API v9では提供されない
    currency: null,
    tags: entry.tags ?? [],
    updated_at: entry.at,
  };
}

// --- Batch upsert functions ---

const BATCH_SIZE = 1000;

/**
 * クライアントをupsert
 */
export async function upsertClients(
  toggl: TogglSchema,
  clients: TogglApiV9Client[]
): Promise<number> {
  if (clients.length === 0) return 0;

  const records = clients.map(toDbClient);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await toggl
      .from("clients")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(`Failed to upsert clients: ${error.message}`);
    }
  }

  return records.length;
}

/**
 * プロジェクトをupsert
 */
export async function upsertProjects(
  toggl: TogglSchema,
  projects: TogglApiV9Project[]
): Promise<number> {
  if (projects.length === 0) return 0;

  const records = projects.map(toDbProject);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await toggl
      .from("projects")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(`Failed to upsert projects: ${error.message}`);
    }
  }

  return records.length;
}

/**
 * タグをupsert
 */
export async function upsertTags(
  toggl: TogglSchema,
  tags: TogglApiV9Tag[]
): Promise<number> {
  if (tags.length === 0) return 0;

  const records = tags.map(toDbTag);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await toggl
      .from("tags")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(`Failed to upsert tags: ${error.message}`);
    }
  }

  return records.length;
}

/**
 * エントリーをupsert
 */
export async function upsertEntries(
  toggl: TogglSchema,
  entries: TogglApiV9TimeEntry[]
): Promise<number> {
  if (entries.length === 0) return 0;

  // 実行中エントリーを除外
  const records = entries
    .map(toDbEntry)
    .filter((entry): entry is DbEntry => entry !== null);

  if (records.length === 0) return 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await toggl
      .from("entries")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(`Failed to upsert entries: ${error.message}`);
    }
  }

  return records.length;
}

// --- High-level helpers ---

/**
 * メタデータ（clients, projects, tags）を並列upsert
 */
export async function upsertMetadata(
  toggl: TogglSchema,
  clients: TogglApiV9Client[],
  projects: TogglApiV9Project[],
  tags: TogglApiV9Tag[]
): Promise<{ clients: number; projects: number; tags: number }> {
  const [clientsCount, projectsCount, tagsCount] = await Promise.all([
    upsertClients(toggl, clients),
    upsertProjects(toggl, projects),
    upsertTags(toggl, tags),
  ]);

  return {
    clients: clientsCount,
    projects: projectsCount,
    tags: tagsCount,
  };
}
