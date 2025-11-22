/**
 * Toggl Track → Supabase 全件同期（初回移行・リカバリ用）
 *
 * v9 API は3ヶ月前までしか取得できないため、Reports API v3 を使用して
 * 全期間のデータを取得する。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_all.ts
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --start=2019-01-01 --end=2024-12-31
 *   deno run --allow-env --allow-net --allow-read sync_all.ts --metadata-only
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import {
  fetchClients,
  fetchProjects,
  fetchTags,
  fetchEntriesByReportsApi,
  formatDate,
  ReportsApiQuotaError,
  ReportsApiRateLimitError,
  type ReportsApiQuota,
} from "./api.ts";
import {
  createTogglDbClient,
  upsertMetadata,
  upsertEntriesFromReports,
} from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（環境変数 TOGGL_SYNC_START_DATE から取得、必須） */
function getDefaultStartDate(): string {
  const startDate = Deno.env.get("TOGGL_SYNC_START_DATE");
  if (!startDate) {
    throw new Error("TOGGL_SYNC_START_DATE is not set");
  }
  return startDate;
}

/** チャンクサイズ（12か月単位で分割） */
export const CHUNK_MONTHS = 12;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * 日付範囲をチャンクに分割
 * Reports APIは長期間のリクエストで遅くなるため、2か月単位で分割
 */
export function splitDateRange(
  startDate: Date,
  endDate: Date,
  chunkMonths: number = CHUNK_MONTHS
): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setMonth(chunkEnd.getMonth() + chunkMonths);

    // endDateを超えないようにする
    const actualEnd = chunkEnd > endDate ? endDate : chunkEnd;

    chunks.push({
      start: formatDate(current),
      end: formatDate(actualEnd),
    });

    current = new Date(actualEnd);
    current.setDate(current.getDate() + 1);
  }

  return chunks;
}

// =============================================================================
// Sync Functions
// =============================================================================

/**
 * メタデータ（clients, projects, tags）のみを同期
 */
async function syncMetadataOnly(): Promise<{
  clients: number;
  projects: number;
  tags: number;
}> {
  log.section("Fetching metadata from Toggl API");

  // 並列取得（staggered delay）
  const [clients, projects, tags] = await Promise.all([
    fetchClients(),
    new Promise<Awaited<ReturnType<typeof fetchProjects>>>(resolve =>
      setTimeout(() => resolve(fetchProjects()), 200)
    ),
    new Promise<Awaited<ReturnType<typeof fetchTags>>>(resolve =>
      setTimeout(() => resolve(fetchTags()), 400)
    ),
  ]);

  log.info(`Clients: ${clients.length}`);
  log.info(`Projects: ${projects.length}`);
  log.info(`Tags: ${tags.length}`);

  log.section("Saving metadata to DB");
  const toggl = createTogglDbClient();
  const metadataStats = await upsertMetadata(toggl, clients, projects, tags);

  return {
    clients: metadataStats.clients.success,
    projects: metadataStats.projects.success,
    tags: metadataStats.tags.success,
  };
}

/**
 * 全期間のエントリーを同期（Reports API v3使用）
 *
 * レート制限:
 * - Free: 30 req/hour
 * - Starter: 240 req/hour
 * - Premium: 600 req/hour
 *
 * page_size=1000なので、無料プランでは1時間に30,000エントリーまで取得可能
 */
async function syncAllEntries(
  startDate: Date,
  endDate: Date
): Promise<number> {
  const toggl = createTogglDbClient();
  const chunks = splitDateRange(startDate, endDate);

  log.info(`Total chunks: ${chunks.length} (${CHUNK_MONTHS}-month intervals)`);
  log.info(`⚠️  Rate limit: waits on 402/429 errors`);

  let totalEntries = 0;
  let totalRequests = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    log.section(`Chunk ${i + 1}/${chunks.length}: ${chunk.start} ~ ${chunk.end}`);

    try {
      // Reports API で取得
      const entries = await fetchEntriesByReportsApi(
        chunk.start,
        chunk.end,
        (fetched: number, quota: ReportsApiQuota) => {
          totalRequests++;
          // 進捗表示
          const quotaInfo = quota.remaining !== null
            ? ` [Quota: ${quota.remaining} remaining]`
            : "";
          // Denoでのインライン更新
          const encoder = new TextEncoder();
          Deno.stdout.writeSync(encoder.encode(`\r  Fetched ${fetched} entries...${quotaInfo}    `));
        }
      );

      console.log(""); // 改行
      log.info(`Fetched ${entries.length} entries (${totalRequests} API requests so far)`);

      if (entries.length > 0) {
        // DB保存
        const result = await upsertEntriesFromReports(toggl, entries);
        totalEntries += result.success;
      }

    } catch (err) {
      if (err instanceof ReportsApiQuotaError) {
        // クォータ超過: 待機してリトライ
        log.warn(`Quota exceeded. Waiting ${err.resetsInSeconds}s for reset...`);
        await new Promise(resolve => setTimeout(resolve, err.resetsInSeconds * 1000));
        // 同じチャンクをリトライ
        i--;
        continue;
      }

      if (err instanceof ReportsApiRateLimitError) {
        // 429: 60秒待機してリトライ
        log.warn(`Rate limited (429). Waiting 60s...`);
        await new Promise(resolve => setTimeout(resolve, 60000));
        i--;
        continue;
      }

      // その他のエラーは再スロー
      throw err;
    }
  }

  log.info(`\nTotal API requests: ${totalRequests}`);
  return totalEntries;
}

/**
 * Toggl データを全件同期
 */
export async function syncAllTogglData(options: {
  startDate: Date;
  endDate: Date;
  metadataOnly?: boolean;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const startStr = formatDate(options.startDate);
  const endStr = formatDate(options.endDate);

  log.syncStart("Toggl (Full)", 0);
  console.log(`   期間: ${startStr} 〜 ${endStr}`);
  console.log(`   メタデータのみ: ${options.metadataOnly ? "Yes" : "No"}\n`);

  try {
    // Step 1: メタデータ同期（常に実行）
    const metadataStats = await syncMetadataOnly();

    let entriesCount = 0;

    // Step 2: エントリー同期（metadataOnlyでない場合）
    if (!options.metadataOnly) {
      log.section("Fetching entries from Reports API v3");
      entriesCount = await syncAllEntries(options.startDate, options.endDate);
    }

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const result: SyncResult = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        clients: metadataStats.clients,
        projects: metadataStats.projects,
        tags: metadataStats.tags,
        entries: entriesCount,
      },
      errors: [],
      elapsedSeconds,
    };

    // サマリー表示
    console.log("\n" + "=".repeat(60));
    log.syncEnd(true, elapsedSeconds);
    log.info(`Clients: ${result.stats.clients}`);
    log.info(`Projects: ${result.stats.projects}`);
    log.info(`Tags: ${result.stats.tags}`);
    log.info(`Entries: ${result.stats.entries}`);
    console.log("=".repeat(60));

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

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["start", "end"],
    boolean: ["help", "metadata-only"],
    alias: { h: "help", s: "start", e: "end", m: "metadata-only" },
  });

  if (args.help) {
    console.log(`
Toggl Track 全件同期（初回移行・リカバリ用）

v9 APIは3ヶ月前までしか取得できないため、Reports API v3を使用。

使用法:
  deno run --allow-env --allow-net --allow-read sync_all.ts [オプション]

オプション:
  --help, -h         このヘルプを表示
  --start, -s        開始日（YYYY-MM-DD）デフォルト: 環境変数 TOGGL_SYNC_START_DATE
  --end, -e          終了日（YYYY-MM-DD）デフォルト: 今日
  --metadata-only, -m メタデータ（clients/projects/tags）のみ同期

例:
  # デフォルト（TOGGL_SYNC_START_DATEから今日まで）
  deno run --allow-env --allow-net --allow-read sync_all.ts

  # 特定期間
  deno run --allow-env --allow-net --allow-read sync_all.ts --start=2020-01-01 --end=2024-12-31

  # メタデータのみ
  deno run --allow-env --allow-net --allow-read sync_all.ts --metadata-only

環境変数:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  TOGGL_API_TOKEN           Toggl API Token
  TOGGL_WORKSPACE_ID        Toggl Workspace ID
  TOGGL_SYNC_START_DATE     デフォルト開始日（必須、--start未指定時）

注意:
  - レート制限 (Freeプラン): 30 req/hour
  - 402/429エラー時は自動でリセットまで待機します
  - 12か月単位でチャンク分割
`);
    Deno.exit(0);
  }

  const startDate = args.start
    ? new Date(args.start)
    : new Date(getDefaultStartDate());
  const endDate = args.end
    ? new Date(args.end)
    : new Date();

  // 日付の妥当性チェック
  if (isNaN(startDate.getTime())) {
    console.error("❌ 無効な開始日です");
    Deno.exit(1);
  }
  if (isNaN(endDate.getTime())) {
    console.error("❌ 無効な終了日です");
    Deno.exit(1);
  }
  if (startDate > endDate) {
    console.error("❌ 開始日は終了日より前である必要があります");
    Deno.exit(1);
  }

  try {
    const result = await syncAllTogglData({
      startDate,
      endDate,
      metadataOnly: args["metadata-only"],
    });

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
