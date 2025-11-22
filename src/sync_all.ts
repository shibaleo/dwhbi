/**
 * 全サービス全件同期オーケストレーター（初回移行・リカバリ用）
 *
 * 各サービスの sync_all.ts を並列実行する。
 * 初回セットアップや長期間のデータ移行に使用。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read src/sync_all.ts
 *   deno run --allow-env --allow-net --allow-read src/sync_all.ts --service=toggl,fitbit
 *   deno run --allow-env --allow-net --allow-read src/sync_all.ts --start=2024-01-01 --end=2024-12-31
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "./utils/log.ts";

import { syncAllTogglData } from "./services/toggl/sync_all.ts";
import { syncAllTanitaData } from "./services/tanita/sync_all.ts";
import { syncAllZaimData } from "./services/zaim/sync_all.ts";
import { syncAllGCalEvents } from "./services/gcalendar/sync_all.ts";
import { syncAllFitbitData } from "./services/fitbit/sync_all.ts";

// =============================================================================
// Types
// =============================================================================

/** 個別サービスの同期結果 */
export interface ServiceResult {
  service: string;
  success: boolean;
  elapsedSeconds: number;
  error?: string;
}

/** 全サービス同期の結果 */
export interface SyncAllResult {
  success: boolean;
  timestamp: string;
  results: ServiceResult[];
  totalElapsedSeconds: number;
}

/** サービス定義 */
interface ServiceConfig {
  name: string;
  envKeyStartDate: string;
  runner: (options: { startDate: Date; endDate: Date }) => Promise<{ success: boolean; elapsedSeconds: number }>;
}

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（各サービスの環境変数から取得） */
function getStartDate(envKey: string): Date {
  const dateStr = Deno.env.get(envKey);
  if (!dateStr) {
    throw new Error(`${envKey} is not set`);
  }
  return new Date(dateStr);
}

const SERVICES: ServiceConfig[] = [
  {
    name: "toggl",
    envKeyStartDate: "TOGGL_SYNC_START_DATE",
    runner: syncAllTogglData,
  },
  {
    name: "fitbit",
    envKeyStartDate: "FITBIT_SYNC_START_DATE",
    runner: syncAllFitbitData,
  },
  {
    name: "tanita",
    envKeyStartDate: "TANITA_SYNC_START_DATE",
    runner: syncAllTanitaData,
  },
  {
    name: "zaim",
    envKeyStartDate: "ZAIM_SYNC_START_DATE",
    runner: syncAllZaimData,
  },
  {
    name: "gcalendar",
    envKeyStartDate: "GCALENDAR_SYNC_START_DATE",
    runner: syncAllGCalEvents,
  },
];

// =============================================================================
// Service Runner
// =============================================================================

/**
 * 単一サービスを実行
 */
async function runService(
  config: ServiceConfig,
  startDate: Date | null,
  endDate: Date
): Promise<ServiceResult> {
  const start = Date.now();

  try {
    // 開始日: CLI指定 > 環境変数
    const effectiveStartDate = startDate ?? getStartDate(config.envKeyStartDate);

    log.info(`[${config.name}] Starting full sync...`);
    log.info(`[${config.name}] Period: ${effectiveStartDate.toISOString().split("T")[0]} ~ ${endDate.toISOString().split("T")[0]}`);

    const result = await config.runner({
      startDate: effectiveStartDate,
      endDate,
    });

    const elapsed = (Date.now() - start) / 1000;
    log.success(`[${config.name}] Completed in ${elapsed.toFixed(1)}s`);

    return {
      service: config.name,
      success: result.success,
      elapsedSeconds: elapsed,
    };
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = err instanceof Error ? err.message : String(err);

    log.error(`[${config.name}] Failed: ${errorMsg}`);

    return {
      service: config.name,
      success: false,
      elapsedSeconds: elapsed,
      error: errorMsg,
    };
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * 全サービスを並列で全件同期
 */
export async function syncAllServicesFullHistory(options?: {
  startDate?: Date;
  endDate?: Date;
  services?: string[];
}): Promise<SyncAllResult> {
  const totalStart = Date.now();
  const timestamp = new Date().toISOString();

  const startDate = options?.startDate ?? null; // nullの場合は各サービスの環境変数から
  const endDate = options?.endDate ?? new Date();

  // 対象サービスをフィルタ
  const targetServices = options?.services
    ? SERVICES.filter((s) => options.services!.includes(s.name))
    : SERVICES;

  if (targetServices.length === 0) {
    log.error("No valid services specified");
    return {
      success: false,
      timestamp,
      results: [],
      totalElapsedSeconds: 0,
    };
  }

  // ヘッダー表示
  log.syncStart("All Services Full Sync (Initial Migration / Recovery)");
  log.info(`Services: ${targetServices.map((s) => s.name).join(", ")}`);
  log.info(`End date: ${endDate.toISOString().split("T")[0]}`);
  if (startDate) {
    log.info(`Start date (override): ${startDate.toISOString().split("T")[0]}`);
  } else {
    log.info("Start date: per-service environment variables");
  }

  // 全サービスを並列実行
  log.section("Starting parallel execution");

  const settledResults = await Promise.allSettled(
    targetServices.map((svc) => runService(svc, startDate, endDate))
  );

  // 結果を抽出
  const results: ServiceResult[] = settledResults.map((settled, index) => {
    if (settled.status === "fulfilled") {
      return settled.value;
    }
    return {
      service: targetServices[index].name,
      success: false,
      elapsedSeconds: 0,
      error: settled.reason?.message || String(settled.reason),
    };
  });

  const totalElapsedSeconds = (Date.now() - totalStart) / 1000;
  const allSuccess = results.every((r) => r.success);

  // サマリー表示
  log.section("Sync Results Summary");

  for (const r of results) {
    const status = r.success ? "✅" : "❌";
    const time = `${r.elapsedSeconds.toFixed(1)}s`;
    const error = r.error ? ` (${r.error})` : "";
    log.info(`${status} ${r.service.padEnd(10)} ${time.padStart(8)}${error}`);
  }

  log.separator("-");
  log.info(`Total time: ${totalElapsedSeconds.toFixed(1)}s`);
  log.syncEnd(allSuccess, totalElapsedSeconds);

  return {
    success: allSuccess,
    timestamp,
    results,
    totalElapsedSeconds,
  };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["start", "end", "service"],
    boolean: ["help"],
    alias: { h: "help", s: "start", e: "end" },
  });

  if (args.help) {
    console.log(`
全サービス全件同期（初回移行・リカバリ用）

各サービスの sync_all.ts を並列実行します。

使用法:
  deno run --allow-env --allow-net --allow-read src/sync_all.ts [オプション]

オプション:
  --help, -h        このヘルプを表示
  --start, -s       開始日（YYYY-MM-DD）全サービス共通で上書き
  --end, -e         終了日（YYYY-MM-DD）デフォルト: 今日
  --service         対象サービス（カンマ区切り）
                    指定可能: toggl, fitbit, tanita, zaim, gcalendar

例:
  # 全サービスをデフォルト開始日から同期
  deno run --allow-env --allow-net --allow-read src/sync_all.ts

  # 特定サービスのみ
  deno run --allow-env --allow-net --allow-read src/sync_all.ts --service=toggl,fitbit

  # 特定期間（全サービス共通）
  deno run --allow-env --allow-net --allow-read src/sync_all.ts --start=2024-01-01 --end=2024-12-31

環境変数（各サービスのデフォルト開始日）:
  TOGGL_SYNC_START_DATE       Toggl開始日
  FITBIT_SYNC_START_DATE      Fitbit開始日
  TANITA_SYNC_START_DATE      Tanita開始日
  ZAIM_SYNC_START_DATE        Zaim開始日
  GCALENDAR_SYNC_START_DATE   Google Calendar開始日

注意:
  - 各サービスのAPIレート制限に注意してください
  - 長期間の同期は時間がかかります
  - レート制限エラー時は各サービスが自動でリトライします
`);
    Deno.exit(0);
  }

  const startDate = args.start ? new Date(args.start) : undefined;
  const endDate = args.end ? new Date(args.end) : undefined;
  const services = args.service ? args.service.split(",").map((s) => s.trim()) : undefined;

  // 日付の妥当性チェック
  if (startDate && isNaN(startDate.getTime())) {
    console.error("❌ 無効な開始日です");
    Deno.exit(1);
  }
  if (endDate && isNaN(endDate.getTime())) {
    console.error("❌ 無効な終了日です");
    Deno.exit(1);
  }
  if (startDate && endDate && startDate > endDate) {
    console.error("❌ 開始日は終了日より前である必要があります");
    Deno.exit(1);
  }

  try {
    const result = await syncAllServicesFullHistory({
      startDate,
      endDate,
      services,
    });

    // JSON結果も出力
    console.log("\n" + JSON.stringify(result, null, 2));

    Deno.exit(result.success ? 0 : 1);
  } catch (err) {
    log.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
