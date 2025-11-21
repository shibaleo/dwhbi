// sync_toggl_to_supabase.ts - Togglデータの同期スクリプト（GitHub Actions用）

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { fetchClientsWithRetry } from "./fetch_clients.ts";
import { fetchProjectsWithRetry } from "./fetch_projects.ts";
import { fetchTagsWithRetry } from "./fetch_tags.ts";
import { fetchRecentTimeEntriesWithRetry } from "./fetch_time_entries.ts";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
} from "./types.ts";

// --- Environment variables ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Rate limiting utility ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_DELAY = 1000; // 1 request per second

// --- Batch configuration ---
const BATCH_SIZE = 1000; // PostgreSQL安全なバッチサイズ

// --- Logging utilities ---
/**
 * Format date to human-readable JST format (YYYY-MM-DD HH:mm:ss)
 */
function formatDateTime(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  
  const year = jst.getFullYear();
  const month = String(jst.getMonth() + 1).padStart(2, '0');
  const day = String(jst.getDate()).padStart(2, '0');
  const hours = String(jst.getHours()).padStart(2, '0');
  const minutes = String(jst.getMinutes()).padStart(2, '0');
  const seconds = String(jst.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function logInfo(message: string) {
  console.log(`${'[INFO]'.padEnd(9)} ${formatDateTime()} - ${message}`);
}

function logSuccess(message: string) {
  console.log(`${'[SUCCESS]'.padEnd(9)} ${formatDateTime()} - ${message}`);
}

function logError(message: string, error?: unknown) {
  console.error(`${'[ERROR]'.padEnd(9)} ${formatDateTime()} - ${message}`);
  if (error) {
    console.error(error);
  }
}

// --- Transformation functions ---

/**
 * API v9 Client → DB Schema
 */
function transformClient(client: TogglApiV9Client) {
  return {
    id: client.id,
    workspace_id: client.wid,
    name: client.name,
    is_archived: client.archived,
    created_at: client.at,
  };
}

/**
 * API v9 Project → DB Schema
 */
function transformProject(project: TogglApiV9Project) {
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
 * API v9 Tag → DB Schema
 */
function transformTag(tag: TogglApiV9Tag) {
  return {
    id: tag.id,
    workspace_id: tag.workspace_id,
    name: tag.name,
    created_at: tag.at,
  };
}

/**
 * API v9 Time Entry → DB Schema
 */
function transformTimeEntry(entry: TogglApiV9TimeEntry) {
  // durationが負の場合は実行中エントリーなのでスキップ
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
    currency: null, // API v9では提供されない
    tags: entry.tags ?? [],
    updated_at: entry.at,
  };
}

// --- Batch upsert functions ---

/**
 * バッチでクライアントをupsert
 */
async function upsertClients(clients: TogglApiV9Client[]): Promise<number> {
  if (clients.length === 0) return 0;

  const transformed = clients.map(transformClient);
  
  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('toggl_clients')
      .upsert(batch, { onConflict: 'id' });
    
    if (error) {
      throw new Error(`Failed to upsert clients: ${error.message}`);
    }
    
    logInfo(`Upserted ${batch.length} clients (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
  }
  
  return transformed.length;
}

/**
 * バッチでプロジェクトをupsert
 */
async function upsertProjects(projects: TogglApiV9Project[]): Promise<number> {
  if (projects.length === 0) return 0;

  const transformed = projects.map(transformProject);
  
  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('toggl_projects')
      .upsert(batch, { onConflict: 'id' });
    
    if (error) {
      throw new Error(`Failed to upsert projects: ${error.message}`);
    }
    
    logInfo(`Upserted ${batch.length} projects (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
  }
  
  return transformed.length;
}

/**
 * バッチでタグをupsert
 */
async function upsertTags(tags: TogglApiV9Tag[]): Promise<number> {
  if (tags.length === 0) return 0;

  const transformed = tags.map(transformTag);
  
  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('toggl_tags')
      .upsert(batch, { onConflict: 'id' });
    
    if (error) {
      throw new Error(`Failed to upsert tags: ${error.message}`);
    }
    
    logInfo(`Upserted ${batch.length} tags (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
  }
  
  return transformed.length;
}

/**
 * バッチでタイムエントリーをupsert
 */
async function upsertTimeEntries(entries: TogglApiV9TimeEntry[]): Promise<number> {
  if (entries.length === 0) return 0;

  const transformed = entries
    .map(transformTimeEntry)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  
  if (transformed.length === 0) {
    logInfo("No completed time entries to upsert (all running entries)");
    return 0;
  }
  
  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('toggl_time_entries')
      .upsert(batch, { onConflict: 'id' });
    
    if (error) {
      throw new Error(`Failed to upsert time entries: ${error.message}`);
    }
    
    logInfo(`Upserted ${batch.length} time entries (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
  }
  
  return transformed.length;
}

// --- Main sync function ---

async function syncTogglToSupabase(days: number = 1) {
  const startTime = Date.now();
  logInfo("=== Starting Toggl to Supabase sync ===");
  
  try {
    // Step 1: Fetch metadata from Toggl (parallel with staggered delays)
    logInfo("Step 1: Fetching metadata from Toggl API...");
    
    // 並列実行（staggered delayでAPIバーストを回避）
    const [clients, projects, tags] = await Promise.all([
      // clients: 即座に開始
      (async () => {
        logInfo("Fetching clients...");
        return await fetchClientsWithRetry();
      })(),
      
      // projects: 200ms後に開始
      (async () => {
        await delay(200);
        logInfo("Fetching projects...");
        return await fetchProjectsWithRetry(true); // include archived
      })(),
      
      // tags: 400ms後に開始
      (async () => {
        await delay(400);
        logInfo("Fetching tags...");
        return await fetchTagsWithRetry();
      })(),
    ]);
    
    logSuccess(`Fetched: ${clients.length} clients, ${projects.length} projects, ${tags.length} tags`);
    
    // Step 2: Fetch recent time entries
    logInfo(`Step 2: Fetching time entries (last ${days} day(s))...`);
    const entries = await fetchRecentTimeEntriesWithRetry(days);
    
    logSuccess(`Fetched: ${entries.length} time entries`);
    
    // Step 3: Sync metadata to Supabase (parallel)
    logInfo("Step 3: Syncing metadata to Supabase...");
    
    const [clientsUpserted, projectsUpserted, tagsUpserted] = await Promise.all([
      upsertClients(clients),
      upsertProjects(projects),
      upsertTags(tags),
    ]);
    
    logSuccess(`Metadata synced: ${clientsUpserted} clients, ${projectsUpserted} projects, ${tagsUpserted} tags`);
    
    // Step 4: Sync time entries to Supabase (after metadata due to foreign key constraints)
    logInfo("Step 4: Syncing time entries to Supabase...");
    const entriesUpserted = await upsertTimeEntries(entries);
    
    logSuccess(`Time entries synced: ${entriesUpserted} entries`);
    
    // Final summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logSuccess(`=== Sync completed successfully in ${duration}s ===`);
    logSuccess(`Summary: ${clientsUpserted} clients, ${projectsUpserted} projects, ${tagsUpserted} tags, ${entriesUpserted} entries`);
    
  } catch (error) {
    logError("Sync failed", error);
    throw error;
  }
}

// --- Main execution ---
if (import.meta.main) {
  // 環境変数から同期日数を取得（デフォルト: 1日）
  const syncDays = parseInt(Deno.env.get('TOGGL_SYNC_DAYS') || '1', 10);
  
  try {
    await syncTogglToSupabase(syncDays);
    Deno.exit(0);
  } catch (error) {
    logError("Fatal error", error);
    Deno.exit(1);
  }
}