/**
 * Tanita → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import { ensureValidToken } from "./auth.ts";
import { fetchTanitaDataByDays } from "./fetch_data.ts";
import {
  createTanitaDbClient,
  saveBloodPressure,
  saveBodyComposition,
  saveSteps,
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
 * Tanita データを Supabase に同期
 * @param syncDays 同期する日数（デフォルト: 3）
 */

export async function syncTanitaByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("TANITA_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  log.syncStart("Tanita", days);

  // 1. トークン確認（必要ならリフレッシュ）
  let accessToken: string;
  try {
    accessToken = await ensureValidToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Auth error: ${message}`);
    return {
      success: false,
      timestamp: new Date().toISOString(),
      stats: { bodyComposition: 0, bloodPressure: 0, steps: 0 },
      errors: [message],
      elapsedSeconds: (Date.now() - startTime) / 1000,
    };
  }

  // 2. データ取得
  const data = await fetchTanitaDataByDays(accessToken, days);

  // 3. DB保存
  log.section("Saving to DB");
  const supabase = createTanitaDbClient();

  const bodyResult = await saveBodyComposition(supabase, data.bodyComposition);
  const bpResult = await saveBloodPressure(supabase, data.bloodPressure);
  const stepsResult = await saveSteps(supabase, data.steps);

  // 4. 結果集計
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  if (bodyResult.failed > 0) errors.push(`body composition: ${bodyResult.failed} failed`);
  if (bpResult.failed > 0) errors.push(`blood pressure: ${bpResult.failed} failed`);
  if (stepsResult.failed > 0) errors.push(`steps: ${stepsResult.failed} failed`);

  const result: SyncResult = {
    success: errors.length === 0,
    timestamp: new Date().toISOString(),
    stats: {
      bodyComposition: bodyResult.success,
      bloodPressure: bpResult.success,
      steps: stepsResult.success,
    },
    errors,
    elapsedSeconds,
  };

  // 5. サマリー表示
  log.syncEnd(result.success, result.elapsedSeconds);
  log.info(`Body composition: ${result.stats.bodyComposition}`);
  log.info(`Blood pressure: ${result.stats.bloodPressure}`);
  log.info(`Steps: ${result.stats.steps}`);
  if (errors.length > 0) {
    log.warn(`Errors: ${errors.join(", ")}`);
  }

  return result;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await syncTanitaByDays();
  Deno.exit(result.success ? 0 : 1);
}
