/**
 * Toggl Track → Supabase 日次同期（差分同期対応）
 *
 * operations.sync_state のlast_record_atを起点に、
 * その日以降のデータのみを取得してupsert。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts --full  # フルリフレッシュ
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import {
  fetchClients,
  fetchProjects,
  fetchTags,
  fetchEntriesByRange,
} from "./api.ts";
import {
  createTogglDbClient,
  upsertMetadata,
  upsertEntries,
} from "./write_db.ts";
import type { SyncResult } from "./types.ts";
import {
  getIncrementalQueryParams,
  updateSyncState,
  logSync,
  extractLatestDate,
} from "../../utils/sync_state.ts";

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME = "toggl";
const ENDPOINT_ENTRIES = "entries";
const DEFAULT_SYNC_DAYS = 7;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Toggl データを Supabase に差分同期
 */
export async function syncTogglIncremental(options?: {
  /** フルリフレッシュを強制 */
  forceFullRefresh?: boolean;
  /** フルリフレッシュ時の日数 */
  defaultDays?: number;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const errors: string[] = [];

  const defaultDays = options?.defaultDays ?? DEFAULT_SYNC_DAYS;

  try {
    // Step 1: クエリパラメータを取得（last_record_atベース）
    const queryParams = await getIncrementalQueryParams(
      SERVICE_NAME,
      ENDPOINT_ENTRIES,
      {
        forceFullRefresh: options?.forceFullRefresh,
        defaultDays,
        marginDays: 1, // 安全マージン: 1日前から
      }
    );

    // ヘッダー表示
    log.syncStart("Toggl", `${queryParams.startDate} ~ ${queryParams.endDate} (${queryParams.mode})`);

    // Step 2: データ取得
    log.section("Fetching from Toggl API");

    // メタデータ並列取得
    const [clients, projects, tags] = await Promise.all([
      fetchClients(),
      fetchProjects(),
      fetchTags(),
    ]);

    // エントリー取得（日付範囲）
    const entries = await fetchEntriesByRange(
      queryParams.startDate,
      queryParams.endDate
    );

    log.info(`Mode: ${queryParams.mode}`);
    log.info(`Period: ${queryParams.startDate} ~ ${queryParams.endDate}`);
    log.info(`Clients: ${clients.length}`);
    log.info(`Projects: ${projects.length}`);
    log.info(`Tags: ${tags.length}`);
    log.info(`Entries: ${entries.length}`);

    // Step 3: メタデータ同期
    log.section("Saving metadata to DB");
    const toggl = createTogglDbClient();
    const metadataStats = await upsertMetadata(toggl, clients, projects, tags);

    if (metadataStats.clients.failed > 0) {
      errors.push(`clients: ${metadataStats.clients.failed} failed`);
    }
    if (metadataStats.projects.failed > 0) {
      errors.push(`projects: ${metadataStats.projects.failed} failed`);
    }
    if (metadataStats.tags.failed > 0) {
      errors.push(`tags: ${metadataStats.tags.failed} failed`);
    }

    // Step 4: エントリー同期
    log.section("Saving entries to DB");
    const entriesResult = await upsertEntries(toggl, entries);

    if (entriesResult.failed > 0) {
      errors.push(`entries: ${entriesResult.failed} failed`);
    }

    // Step 5: 同期状態を更新
    const completedAt = new Date();
    const elapsedMs = Date.now() - startTime;

    // 最新エントリーの開始日を取得（startフィールド）
    const lastRecordAt = extractLatestDate(entries, "start");

    await updateSyncState(SERVICE_NAME, ENDPOINT_ENTRIES, {
      last_synced_at: completedAt,
      last_record_at: lastRecordAt,
    });

    // 同期ログを記録
    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_ENTRIES,
      run_id: runId,
      sync_mode: queryParams.mode,
      query_from: queryParams.startDate,
      query_to: queryParams.endDate,
      status: errors.length === 0 ? "success" : "partial",
      records_fetched: entries.length,
      records_inserted: entriesResult.success,
      started_at: new Date(startTime).toISOString(),
      completed_at: completedAt.toISOString(),
      elapsed_ms: elapsedMs,
      api_calls: 4, // clients + projects + tags + entries
    });

    // 結果集計
    const elapsedSeconds = elapsedMs / 1000;

    const result: SyncResult = {
      success: errors.length === 0,
      timestamp: completedAt.toISOString(),
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
    const elapsedMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    log.error(message);

    await logSync({
      service_name: SERVICE_NAME,
      endpoint_name: ENDPOINT_ENTRIES,
      run_id: runId,
      sync_mode: "incremental",
      status: "failed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      elapsed_ms: elapsedMs,
      error_message: message,
    });

    log.syncEnd(false, elapsedMs / 1000);

    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { clients: 0, projects: 0, tags: 0, entries: 0 },
      errors,
      elapsedSeconds: elapsedMs / 1000,
    };
  }
}

/**
 * 日数指定での同期（後方互換性用）
 */
export async function syncTogglByDays(syncDays?: number): Promise<SyncResult> {
  return syncTogglIncremental({
    defaultDays: syncDays ?? DEFAULT_SYNC_DAYS,
  });
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["full", "help"],
    string: ["days"],
    alias: { f: "full", h: "help", d: "days" },
  });

  if (args.help) {
    console.log(`
Toggl 差分同期

使用法:
  deno run --allow-env --allow-net --allow-read sync_daily.ts [オプション]

オプション:
  --help, -h    このヘルプを表示
  --full, -f    フルリフレッシュ（過去N日分を取得）
  --days, -d    フルリフレッシュ時の日数（デフォルト: 7）

動作:
  - 初回実行時: 過去N日分をフル取得
  - 2回目以降: last_record_at以降のデータのみ取得（差分同期）
  - --full 指定時: 強制的にフル取得

同期状態は operations.sync_state テーブルに保存されます。
`);
    Deno.exit(0);
  }

  const result = await syncTogglIncremental({
    forceFullRefresh: args.full,
    defaultDays: args.days ? parseInt(args.days) : undefined,
  });

  Deno.exit(result.success ? 0 : 1);
}
