/**
 * 全サービス並列同期オーケストレーター
 * 
 * GitHub Actions から呼び出され、全サービスを並列で同期する。
 * 単一ジョブで実行することで、課金を最小化する。
 * 
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read src/sync_all.ts
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";

// 各サービスの同期関数をインポート（命名規則: sync{Service}ByDays）
import { syncTogglByDays } from "./services/toggl/sync_daily.ts";
import { syncTanitaByDays } from "./services/tanita/sync_daily.ts";
import { syncZaimByDays } from "./services/zaim/sync_daily.ts";
import { syncGCalByDays } from "./services/gcalendar/sync_daily.ts";
import { syncFitbitByDays } from "./services/fitbit/sync_daily.ts";

// =============================================================================
// Types
// =============================================================================

interface ServiceResult {
  service: string;
  success: boolean;
  elapsedSeconds: number;
  error?: string;
}

interface SyncAllResult {
  success: boolean;
  timestamp: string;
  results: ServiceResult[];
  totalElapsedSeconds: number;
}

// =============================================================================
// Logging
// =============================================================================

function getJstTimestamp(): string {
  return new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).replace(/\//g, "-");
}

function log(level: string, message: string): void {
  const timestamp = getJstTimestamp();
  console.log(`${timestamp} [${level.padEnd(7)}] ${message}`);
}

function logSection(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

// =============================================================================
// Service Wrappers
// =============================================================================

async function runToggl(days: number): Promise<ServiceResult> {
  const start = Date.now();
  try {
    log("INFO", `[Toggl] Starting sync (${days} days)...`);
    const result = await syncTogglByDays(days);
    const elapsed = (Date.now() - start) / 1000;
    log("SUCCESS", `[Toggl] Completed in ${elapsed.toFixed(1)}s - ${result.stats.entries} entries`);
    return { service: "toggl", success: result.success, elapsedSeconds: elapsed };
  } catch (error) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);
    log("ERROR", `[Toggl] Failed: ${errorMsg}`);
    return { service: "toggl", success: false, elapsedSeconds: elapsed, error: errorMsg };
  }
}

async function runTanita(days: number): Promise<ServiceResult> {
  const start = Date.now();
  try {
    log("INFO", `[Tanita] Starting sync (${days} days)...`);
    const result = await syncTanitaByDays(days);
    const elapsed = (Date.now() - start) / 1000;
    const total = (result.stats.bodyComposition ?? 0) + (result.stats.bloodPressure ?? 0) + (result.stats.steps ?? 0);
    log("SUCCESS", `[Tanita] Completed in ${elapsed.toFixed(1)}s - ${total} records`);
    return { service: "tanita", success: result.success, elapsedSeconds: elapsed };
  } catch (error) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);
    log("ERROR", `[Tanita] Failed: ${errorMsg}`);
    return { service: "tanita", success: false, elapsedSeconds: elapsed, error: errorMsg };
  }
}

async function runZaim(days: number): Promise<ServiceResult> {
  const start = Date.now();
  try {
    log("INFO", `[Zaim] Starting sync (${days} days)...`);
    const result = await syncZaimByDays(days);
    const elapsed = (Date.now() - start) / 1000;
    const txCount = result.stats.transactions.inserted + result.stats.transactions.updated;
    log("SUCCESS", `[Zaim] Completed in ${elapsed.toFixed(1)}s - ${txCount} transactions`);
    return { service: "zaim", success: result.success, elapsedSeconds: elapsed };
  } catch (error) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);
    log("ERROR", `[Zaim] Failed: ${errorMsg}`);
    return { service: "zaim", success: false, elapsedSeconds: elapsed, error: errorMsg };
  }
}

async function runGCalendar(days: number): Promise<ServiceResult> {
  const start = Date.now();
  try {
    log("INFO", `[GCal] Starting sync (${days} days)...`);
    const result = await syncGCalByDays(days);
    const elapsed = (Date.now() - start) / 1000;
    log("SUCCESS", `[GCal] Completed in ${elapsed.toFixed(1)}s - ${result.stats.upserted} events`);
    return { service: "gcalendar", success: result.success, elapsedSeconds: elapsed };
  } catch (error) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);
    log("ERROR", `[GCal] Failed: ${errorMsg}`);
    return { service: "gcalendar", success: false, elapsedSeconds: elapsed, error: errorMsg };
  }
}

async function runFitbit(days: number): Promise<ServiceResult> {
  const start = Date.now();
  try {
    log("INFO", `[Fitbit] Starting sync (${days} days)...`);
    const result = await syncFitbitByDays(days);
    const elapsed = (Date.now() - start) / 1000;
    const total = result.stats.sleep + result.stats.activity + result.stats.heartRate + result.stats.hrv;
    log("SUCCESS", `[Fitbit] Completed in ${elapsed.toFixed(1)}s - ${total} records`);
    return { service: "fitbit", success: result.success, elapsedSeconds: elapsed };
  } catch (error) {
    const elapsed = (Date.now() - start) / 1000;
    const errorMsg = error instanceof Error ? error.message : String(error);
    log("ERROR", `[Fitbit] Failed: ${errorMsg}`);
    return { service: "fitbit", success: false, elapsedSeconds: elapsed, error: errorMsg };
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

export async function syncAllServices(options?: {
  togglDays?: number;
  tanitaDays?: number;
  zaimDays?: number;
  gcalDays?: number;
  fitbitDays?: number;
}): Promise<SyncAllResult> {
  const totalStart = Date.now();
  const timestamp = new Date().toISOString();

  // デフォルト値（全サービス3日）
  const togglDays = options?.togglDays ?? parseInt(Deno.env.get("TOGGL_SYNC_DAYS") || "3", 10);
  const tanitaDays = options?.tanitaDays ?? parseInt(Deno.env.get("TANITA_SYNC_DAYS") || "3", 10);
  const zaimDays = options?.zaimDays ?? parseInt(Deno.env.get("ZAIM_SYNC_DAYS") || "3", 10);
  const gcalDays = options?.gcalDays ?? parseInt(Deno.env.get("GCAL_SYNC_DAYS") || "3", 10);
  const fitbitDays = options?.fitbitDays ?? parseInt(Deno.env.get("FITBIT_SYNC_DAYS") || "3", 10);

  logSection("🚀 All Services Parallel Sync Started");
  console.log(`  Toggl:    ${togglDays} days`);
  console.log(`  Tanita:   ${tanitaDays} days`);
  console.log(`  Zaim:     ${zaimDays} days`);
  console.log(`  GCal:     ${gcalDays} days`);
  console.log(`  Fitbit:   ${fitbitDays} days`);

  // 全サービスを並列実行
  log("INFO", "Starting parallel execution...");
  
  const settledResults = await Promise.allSettled([
    runToggl(togglDays),
    runTanita(tanitaDays),
    runZaim(zaimDays),
    runGCalendar(gcalDays),
    runFitbit(fitbitDays),
  ]);

  // 結果を抽出
  const results: ServiceResult[] = settledResults.map((settled, index) => {
    const services = ["toggl", "tanita", "zaim", "gcalendar", "fitbit"];
    if (settled.status === "fulfilled") {
      return settled.value;
    } else {
      return {
        service: services[index],
        success: false,
        elapsedSeconds: 0,
        error: settled.reason?.message || String(settled.reason),
      };
    }
  });

  const totalElapsedSeconds = (Date.now() - totalStart) / 1000;
  const allSuccess = results.every((r) => r.success);

  // サマリー表示
  logSection("📊 Sync Results Summary");
  
  for (const r of results) {
    const status = r.success ? "✅" : "❌";
    const time = r.elapsedSeconds.toFixed(1) + "s";
    const error = r.error ? ` (${r.error})` : "";
    console.log(`  ${status} ${r.service.padEnd(10)} ${time.padStart(6)}${error}`);
  }
  
  console.log("─".repeat(60));
  console.log(`  Total time: ${totalElapsedSeconds.toFixed(1)}s`);
  console.log(`  Status: ${allSuccess ? "✅ All succeeded" : "❌ Some failed"}`);
  console.log("=".repeat(60));

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
  } catch (error) {
    log("ERROR", `Fatal error: ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }
}
