/**
 * Toggl Track → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   TOGGL_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import { fetchTogglData } from "./fetch_data.ts";
import {
  createTogglDbClient,
  upsertMetadata,
  upsertEntries,
} from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Toggl データを Supabase に同期
 * @param syncDays 同期する日数（デフォルト: 3）
 */
export async function syncTogglByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("TOGGL_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  log.syncStart("Toggl", days);

  try {
    // Step 1: データ取得
    log.section("Fetching from Toggl API");
    const data = await fetchTogglData(days);
    log.info(`Clients: ${data.clients.length}`);
    log.info(`Projects: ${data.projects.length}`);
    log.info(`Tags: ${data.tags.length}`);
    log.info(`Entries: ${data.entries.length}`);

    // Step 2: メタデータ同期（並列）
    log.section("Saving metadata to DB");
    const toggl = createTogglDbClient();
    const metadataStats = await upsertMetadata(
      toggl,
      data.clients,
      data.projects,
      data.tags
    );

    if (metadataStats.clients.failed > 0) {
      errors.push(`clients: ${metadataStats.clients.failed} failed`);
    }
    if (metadataStats.projects.failed > 0) {
      errors.push(`projects: ${metadataStats.projects.failed} failed`);
    }
    if (metadataStats.tags.failed > 0) {
      errors.push(`tags: ${metadataStats.tags.failed} failed`);
    }

    // Step 3: エントリー同期（外部キー制約のためメタデータ後）
    log.section("Saving entries to DB");
    const entriesResult = await upsertEntries(toggl, data.entries);

    if (entriesResult.failed > 0) {
      errors.push(`entries: ${entriesResult.failed} failed`);
    }

    // 結果集計
    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const result: SyncResult = {
      success: errors.length === 0,
      timestamp: new Date().toISOString(),
      stats: {
        clients: metadataStats.clients.success,
        projects: metadataStats.projects.success,
        tags: metadataStats.tags.success,
        entries: entriesResult.success,
      },
      errors,
      elapsedSeconds,
    };

    // サマリー表示
    log.syncEnd(result.success, elapsedSeconds);
    log.info(`Clients: ${result.stats.clients}`);
    log.info(`Projects: ${result.stats.projects}`);
    log.info(`Tags: ${result.stats.tags}`);
    log.info(`Entries: ${result.stats.entries}`);
    if (errors.length > 0) {
      log.warn(`Errors: ${errors.join(", ")}`);
    }

    return result;

  } catch (err) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    log.syncEnd(false, elapsedSeconds);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { clients: 0, projects: 0, tags: 0, entries: 0 },
      errors,
      elapsedSeconds,
    };
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await syncTogglByDays();
  Deno.exit(result.success ? 0 : 1);
}
