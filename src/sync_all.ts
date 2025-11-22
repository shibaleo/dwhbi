/**
 * 全サービス並列同期オーケストレーター
 *
 * GitHub Actions から呼び出され、全サービスを並列で同期する。
 * 単一ジョブで実行することで、課金を最小化する。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read src/sync_all.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "./utils/log.ts";

import { syncTogglByDays } from "./services/toggl/sync_daily.ts";
import { syncTanitaByDays } from "./services/tanita/sync_daily.ts";
import { syncZaimByDays } from "./services/zaim/sync_daily.ts";
import { syncGCalByDays } from "./services/gcalendar/sync_daily.ts";
import { syncFitbitByDays } from "./services/fitbit/sync_daily.ts";

// =============================================================================
// Types
// =============================================================================

/** 個別サービスの同期結果 */
export interface ServiceResult {
  service: string;
  success: boolean;
  elapsedSeconds: number;
  recordCount: number;
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
  envKey: string;
  runner: (days: number) => Promise<{ success: boolean; stats: Record<string, number> }>;
  countFn: (stats: Record<string, number>) => number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

const SERVICES: ServiceConfig[] = [
  {
    name: "toggl",
    envKey: "TOGGL_SYNC_DAYS",
    runner: syncTogglByDays,
    countFn: (s) => s.entries ?? 0,
  },
  {
    name: "tanita",
    envKey: "TANITA_SYNC_DAYS",
    runner: syncTanitaByDays,
    countFn: (s) => (s.bodyComposition ?? 0) + (s.bloodPressure ?? 0) + (s.steps ?? 0),
  },
  {
    name: "zaim",
    envKey: "ZAIM_SYNC_DAYS",
    runner: syncZaimByDays,
    countFn: (s) => {
      if (s.transactions && typeof s.transactions === "object") {
        const tx = s.transactions as { inserted?: number; updated?: number };
        return (tx.inserted ?? 0) + (tx.updated ?? 0);
      }
      return 0;
    },
  },
  {
    name: "gcalendar",
    envKey: "GCAL_SYNC_DAYS",
    runner: syncGCalByDays,
    countFn: (s) => s.upserted ?? 0,
  },
  {
    name: "fitbit",
    envKey: "FITBIT_SYNC_DAYS",
    runner: syncFitbitByDays,
    countFn: (s) => (s.sleep ?? 0) + (s.activity ?? 0) + (s.heartRate ?? 0) + (s.hrv ?? 0),
  },
];

// =============================================================================
// Service Runner
// =============================================================================

/**
 * 単一サービスを実行
 */
async function runService(config: ServiceConfig, days: number): Promise<ServiceResult> {
  const start = Date.now();

  try {
    log.info(`[${config.name}] Starting sync (${days} days)...`);
    const result = await config.runner(days);
    const elapsed = (Date.now() - start) / 1000;
    const count = config.countFn(result.stats);

    log.success(`[${config.name}] Completed in ${elapsed.toFixed(1)}s - ${count} records`);

    return {
      service: config.name,
      success: result.success,
      elapsedSeconds: elapsed,
      recordCount: count,
    };
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = err instanceof Error ? err.message : String(err);

    log.error(`[${config.name}] Failed: ${errorMsg}`);

    return {
      service: config.name,
      success: false,
      elapsedSeconds: elapsed,
      recordCount: 0,
      error: errorMsg,
    };
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * 全サービスを並列同期
 */
export async function syncAllServices(options?: {
  togglDays?: number;
  tanitaDays?: number;
  zaimDays?: number;
  gcalDays?: number;
  fitbitDays?: number;
}): Promise<SyncAllResult> {
  const totalStart = Date.now();
  const timestamp = new Date().toISOString();

  // 各サービスの同期日数を決定
  const daysByService: Record<string, number> = {
    toggl: options?.togglDays ?? parseInt(Deno.env.get("TOGGL_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS)),
    tanita: options?.tanitaDays ?? parseInt(Deno.env.get("TANITA_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS)),
    zaim: options?.zaimDays ?? parseInt(Deno.env.get("ZAIM_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS)),
    gcalendar: options?.gcalDays ?? parseInt(Deno.env.get("GCAL_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS)),
    fitbit: options?.fitbitDays ?? parseInt(Deno.env.get("FITBIT_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS)),
  };

  // ヘッダー表示
  log.syncStart("All Services Parallel Sync");
  for (const svc of SERVICES) {
    log.info(`${svc.name}: ${daysByService[svc.name]} days`);
  }

  // 全サービスを並列実行
  log.section("Starting parallel execution");

  const settledResults = await Promise.allSettled(
    SERVICES.map((svc) => runService(svc, daysByService[svc.name]))
  );

  // 結果を抽出
  const results: ServiceResult[] = settledResults.map((settled, index) => {
    if (settled.status === "fulfilled") {
      return settled.value;
    }
    return {
      service: SERVICES[index].name,
      success: false,
      elapsedSeconds: 0,
      recordCount: 0,
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
    const count = `${r.recordCount} records`;
    const error = r.error ? ` (${r.error})` : "";
    log.info(`${status} ${r.service.padEnd(10)} ${time.padStart(6)} - ${count}${error}`);
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

if (import.meta.main) {
  try {
    const result = await syncAllServices();

    // JSON結果も出力（GitHub Actions用）
    console.log("\n" + JSON.stringify(result, null, 2));

    Deno.exit(result.success ? 0 : 1);
  } catch (err) {
    log.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
}
