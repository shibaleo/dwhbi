/**
 * Fitbit → Supabase 日次同期
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_daily.ts
 *   FITBIT_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts
 */

import "jsr:@std/dotenv/load";
import * as log from "../../utils/log.ts";
import { ensureValidToken } from "./auth.ts";
import { fetchFitbitDataByDays } from "./fetch_data.ts";
import { createFitbitDbClient, saveAllFitbitData } from "./write_db.ts";
import type { SyncResult } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SYNC_DAYS = 3;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Fitbit データを Supabase に同期
 * @param syncDays 同期する日数（デフォルト: 3）
 */

export async function syncFitbitByDays(syncDays?: number): Promise<SyncResult> {
  const startTime = Date.now();
  const days = syncDays ??
    parseInt(Deno.env.get("FITBIT_SYNC_DAYS") || String(DEFAULT_SYNC_DAYS));
  const errors: string[] = [];

  log.syncStart("Fitbit", days);

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
      stats: {
        sleep: 0,
        activity: 0,
        heartRate: 0,
        hrv: 0,
        spo2: 0,
        breathingRate: 0,
        cardioScore: 0,
        temperatureSkin: 0,
      },
      errors: [message],
      elapsedSeconds: (Date.now() - startTime) / 1000,
    };
  }

  // 2. データ取得
  const data = await fetchFitbitDataByDays(accessToken, days);

  // 3. DB保存
  log.section("Saving to DB");
  const supabase = createFitbitDbClient();
  const results = await saveAllFitbitData(supabase, data);

  // 4. 結果集計
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  if (results.sleep.failed > 0) errors.push(`sleep: ${results.sleep.failed} failed`);
  if (results.activity.failed > 0) errors.push(`activity: ${results.activity.failed} failed`);
  if (results.heartRate.failed > 0) errors.push(`heart rate: ${results.heartRate.failed} failed`);
  if (results.hrv.failed > 0) errors.push(`HRV: ${results.hrv.failed} failed`);
  if (results.spo2.failed > 0) errors.push(`SpO2: ${results.spo2.failed} failed`);
  if (results.breathingRate.failed > 0) errors.push(`breathing rate: ${results.breathingRate.failed} failed`);
  if (results.cardioScore.failed > 0) errors.push(`VO2 Max: ${results.cardioScore.failed} failed`);
  if (results.temperatureSkin.failed > 0) errors.push(`skin temp: ${results.temperatureSkin.failed} failed`);

  const result: SyncResult = {
    success: errors.length === 0,
    timestamp: new Date().toISOString(),
    stats: {
      sleep: results.sleep.success,
      activity: results.activity.success,
      heartRate: results.heartRate.success,
      hrv: results.hrv.success,
      spo2: results.spo2.success,
      breathingRate: results.breathingRate.success,
      cardioScore: results.cardioScore.success,
      temperatureSkin: results.temperatureSkin.success,
    },
    errors,
    elapsedSeconds,
  };

  // 5. サマリー表示
  log.syncEnd(result.success, result.elapsedSeconds);
  log.info(`Sleep: ${result.stats.sleep}`);
  log.info(`Activity: ${result.stats.activity}`);
  log.info(`Heart rate: ${result.stats.heartRate}`);
  log.info(`HRV: ${result.stats.hrv}`);
  log.info(`SpO2: ${result.stats.spo2}`);
  log.info(`Breathing rate: ${result.stats.breathingRate}`);
  log.info(`VO2 Max: ${result.stats.cardioScore}`);
  log.info(`Skin temperature: ${result.stats.temperatureSkin}`);
  if (errors.length > 0) {
    log.warn(`Errors: ${errors.join(", ")}`);
  }

  return result;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const result = await syncFitbitByDays();
  Deno.exit(result.success ? 0 : 1);
}
