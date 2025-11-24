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
import { formatTogglDate } from "./api.ts";
import {
  fetchTogglMetadata,
  fetchTogglDataWithChunks,
} from "./fetch_data.ts";
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

// =============================================================================
// Sync Functions
// =============================================================================

/**
 * メタデータのみ同期
 */
async function syncMetadataOnly(): Promise<{
  clients: number;
  projects: number;
  tags: number;
}> {
  // メタデータ取得
  const { clients, projects, tags } = await fetchTogglMetadata();

  // DB保存
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
 * Toggl データを全件同期
 */
export async function syncAllTogglData(options: {
  startDate: Date;
  endDate: Date;
  metadataOnly?: boolean;
}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const startStr = formatTogglDate(options.startDate);
  const endStr = formatTogglDate(options.endDate);

  log.syncStart("Toggl (Full)", 0);
  console.log(`   期間: ${startStr} 〜 ${endStr}`);
  console.log(`   メタデータのみ: ${options.metadataOnly ? "Yes" : "No"}\n`);

  try {
    let metadataStats = { clients: 0, projects: 0, tags: 0 };
    let entriesCount = 0;

    if (options.metadataOnly) {
      // メタデータのみ同期
      metadataStats = await syncMetadataOnly();
    } else {
      // 全データ取得（fetch_data.tsがチャンク処理を担当）
      log.section("Step 1: Fetching all data");
      const data = await fetchTogglDataWithChunks(
        options.startDate,
        options.endDate,
        (progress) => {
          // 進捗表示（インライン更新）
          const quotaInfo = progress.quota.remaining !== null
            ? ` [Quota: ${progress.quota.remaining}]`
            : "";
          const encoder = new TextEncoder();
          Deno.stdout.writeSync(
            encoder.encode(`\r  Fetched ${progress.entriesFetched} entries...${quotaInfo}    `)
          );
        }
      );
      console.log(""); // 改行

      // Step 2: メタデータ保存
      log.section("Step 2: Saving metadata to DB");
      const toggl = createTogglDbClient();
      const metaResult = await upsertMetadata(
        toggl,
        data.clients,
        data.projects,
        data.tags
      );
      metadataStats = {
        clients: metaResult.clients.success,
        projects: metaResult.projects.success,
        tags: metaResult.tags.success,
      };

      // Step 3: エントリー保存
      log.section("Step 3: Saving entries to DB");
      if (data.entries.length > 0) {
        const entryResult = await upsertEntriesFromReports(toggl, data.entries);
        entriesCount = entryResult.success;
      }
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
    if (!options.metadataOnly) {
      log.info(`Entries: ${result.stats.entries}`);
    }
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
  --help, -h           このヘルプを表示
  --start, -s          開始日（YYYY-MM-DD）デフォルト: 環境変数 TOGGL_SYNC_START_DATE
  --end, -e            終了日（YYYY-MM-DD）デフォルト: 今日
  --metadata-only, -m  メタデータ（clients/projects/tags）のみ同期

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
  - 12ヶ月単位でチャンク分割して取得します
  - レート制限（402/429）エラー時は自動で待機・リトライします
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
