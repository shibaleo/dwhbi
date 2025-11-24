/**
 * Fitbit データの Supabase 書き込み
 *
 * raw スキーマへのデータ変換と upsert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import type {
  FitbitApiActivitySummary,
  FitbitApiAzmDay,
  FitbitApiBreathingRateDay,
  FitbitApiCardioScoreDay,
  FitbitApiHeartRateDay,
  FitbitApiHeartRateIntraday,
  FitbitApiHrvDay,
  FitbitApiSleepLog,
  FitbitApiSpo2Response,
  FitbitApiTemperatureSkinDay,
  DbActivityDaily,
  DbBreathingRateDaily,
  DbCardioScoreDaily,
  DbHeartRateDaily,
  DbHrvDaily,
  DbSleep,
  DbSpo2Daily,
  DbTemperatureSkinDaily,
  FitbitData,
} from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/** raw スキーマ用クライアント型 */
export type RawSchema = ReturnType<SupabaseClient["schema"]>;

/** upsert 結果 */
export interface UpsertResult {
  success: number;
  failed: number;
}

// =============================================================================
// Constants
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// Client Factory
// =============================================================================

/**
 * raw スキーマ専用の Supabase クライアントを作成
 */
export function createFitbitDbClient(): RawSchema {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("raw");
}

// =============================================================================
// Transform Functions: API → DB Record
// =============================================================================

/**
 * Fitbit APIのタイムゾーン情報なしISO8601文字列（JST想定）をUTCに変換
 * 
 * Fitbit APIは "2025-11-22T02:04:30.000" のようにタイムゾーン情報なしで返すが、
 * これはJSTの時刻を表している。PostgreSQLのtimestamptzに保存する際は
 * UTCに変換する必要がある。
 * 
 * @param jstTimeString タイムゾーン情報なしのISO8601文字列（JST想定）
 * @returns UTC ISO8601文字列
 */
function convertJSTtoUTC(jstTimeString: string): string {
  // JSTタイムゾーン情報を付加してDateオブジェクト作成
  const jstDate = new Date(jstTimeString + '+09:00');
  // UTCのISO8601文字列に変換
  return jstDate.toISOString();
}

/**
 * 睡眠データを DB レコードに変換
 */
export function toDbSleep(items: FitbitApiSleepLog[]): DbSleep[] {
  return items.map((item) => ({
    date: item.dateOfSleep,
    start_time: convertJSTtoUTC(item.startTime),
    end_time: convertJSTtoUTC(item.endTime),
    duration_ms: item.duration,
    efficiency: item.efficiency,
    is_main_sleep: item.isMainSleep,
    minutes_asleep: item.minutesAsleep,
    minutes_awake: item.minutesAwake,
    time_in_bed: item.timeInBed,
    sleep_type: item.type,
    levels: item.levels,
    log_id: item.logId,
  }));
}

/**
 * 活動データを DB レコードに変換
 */
export function toDbActivityDaily(
  activityMap: Map<string, FitbitApiActivitySummary>,
  azmData: FitbitApiAzmDay[],
  intradayMap?: Map<string, unknown>,
): DbActivityDaily[] {
  const azmMap = new Map<string, FitbitApiAzmDay>();
  for (const azm of azmData) {
    azmMap.set(azm.dateTime, azm);
  }

  const records: DbActivityDaily[] = [];

  for (const [date, summary] of activityMap) {
    const totalDistance = summary.distances?.find(
      (d) => d.activity === "total",
    )?.distance;

    const azm = azmMap.get(date);

    records.push({
      date,
      steps: summary.steps,
      distance_km: totalDistance,
      floors: summary.floors,
      calories_total: summary.caloriesOut,
      calories_bmr: summary.caloriesBMR,
      calories_activity: summary.activityCalories,
      sedentary_minutes: summary.sedentaryMinutes,
      lightly_active_minutes: summary.lightlyActiveMinutes,
      fairly_active_minutes: summary.fairlyActiveMinutes,
      very_active_minutes: summary.veryActiveMinutes,
      active_zone_minutes: azm?.value,
      intraday: intradayMap?.get(date),
    });
  }

  return records;
}

/**
 * 心拍データを DB レコードに変換
 */
export function toDbHeartRateDaily(
  items: FitbitApiHeartRateDay[],
  intradayMap?: Map<string, FitbitApiHeartRateIntraday>,
): DbHeartRateDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    resting_heart_rate: item.value.restingHeartRate,
    heart_rate_zones: item.value.heartRateZones,
    intraday: intradayMap?.get(item.dateTime),
  }));
}

/**
 * HRV データを DB レコードに変換
 */
export function toDbHrvDaily(items: FitbitApiHrvDay[]): DbHrvDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    daily_rmssd: item.value.dailyRmssd,
    deep_rmssd: item.value.deepRmssd,
    intraday: item.minutes,
  }));
}

/**
 * SpO2 データを DB レコードに変換
 */
export function toDbSpo2Daily(
  spo2Map: Map<string, FitbitApiSpo2Response>,
): DbSpo2Daily[] {
  const records: DbSpo2Daily[] = [];

  for (const [date, data] of spo2Map) {
    if (data.value) {
      records.push({
        date,
        avg_spo2: data.value.avg,
        min_spo2: data.value.min,
        max_spo2: data.value.max,
      });
    }
  }

  return records;
}

/**
 * 呼吸数データを DB レコードに変換
 */
export function toDbBreathingRateDaily(
  items: FitbitApiBreathingRateDay[],
): DbBreathingRateDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    breathing_rate: item.value.breathingRate,
  }));
}

/**
 * VO2 Max データを DB レコードに変換
 */
export function toDbCardioScoreDaily(
  items: FitbitApiCardioScoreDay[],
): DbCardioScoreDaily[] {
  return items.map((item) => {
    const vo2Value = item.value.vo2Max;
    let vo2Max: number | undefined;
    let vo2MaxRangeLow: number | undefined;
    let vo2MaxRangeHigh: number | undefined;

    if (vo2Value.includes("-")) {
      const [low, high] = vo2Value.split("-").map(Number);
      vo2MaxRangeLow = low;
      vo2MaxRangeHigh = high;
      vo2Max = (low + high) / 2;
    } else {
      vo2Max = parseFloat(vo2Value);
    }

    return {
      date: item.dateTime,
      vo2_max: vo2Max,
      vo2_max_range_low: vo2MaxRangeLow,
      vo2_max_range_high: vo2MaxRangeHigh,
    };
  });
}

/**
 * 皮膚温度データを DB レコードに変換
 */
export function toDbTemperatureSkinDaily(
  items: FitbitApiTemperatureSkinDay[],
): DbTemperatureSkinDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    nightly_relative: item.value.nightlyRelative,
    log_type: item.logType,
  }));
}

// =============================================================================
// Batch Upsert
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch<T extends object>(
  raw: RawSchema,
  table: string,
  records: T[],
  onConflict: string,
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await raw
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      log.error(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

// =============================================================================
// Save Functions
// =============================================================================

/**
 * 睡眠データを DB に保存
 */
export async function saveSleep(
  raw: RawSchema,
  items: FitbitApiSleepLog[],
): Promise<UpsertResult> {
  const records = toDbSleep(items);
  log.info(`Saving sleep... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_sleep", records, "log_id");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 活動データを DB に保存
 */
export async function saveActivityDaily(
  raw: RawSchema,
  activityMap: Map<string, FitbitApiActivitySummary>,
  azmData: FitbitApiAzmDay[],
): Promise<UpsertResult> {
  const records = toDbActivityDaily(activityMap, azmData);
  log.info(`Saving activity... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_activity_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 心拍数データを DB に保存
 */
export async function saveHeartRateDaily(
  raw: RawSchema,
  items: FitbitApiHeartRateDay[],
  intradayMap?: Map<string, FitbitApiHeartRateIntraday>,
): Promise<UpsertResult> {
  const records = toDbHeartRateDaily(items, intradayMap);
  log.info(`Saving heart rate... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_heart_rate_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * HRV データを DB に保存
 */
export async function saveHrvDaily(
  raw: RawSchema,
  items: FitbitApiHrvDay[],
): Promise<UpsertResult> {
  const records = toDbHrvDaily(items);
  log.info(`Saving HRV... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_hrv_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * SpO2 データを DB に保存
 */
export async function saveSpo2Daily(
  raw: RawSchema,
  spo2Map: Map<string, FitbitApiSpo2Response>,
): Promise<UpsertResult> {
  const records = toDbSpo2Daily(spo2Map);
  log.info(`Saving SpO2... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_spo2_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 呼吸数データを DB に保存
 */
export async function saveBreathingRateDaily(
  raw: RawSchema,
  items: FitbitApiBreathingRateDay[],
): Promise<UpsertResult> {
  const records = toDbBreathingRateDaily(items);
  log.info(`Saving breathing rate... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_breathing_rate_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * VO2 Max データを DB に保存
 */
export async function saveCardioScoreDaily(
  raw: RawSchema,
  items: FitbitApiCardioScoreDay[],
): Promise<UpsertResult> {
  const records = toDbCardioScoreDaily(items);
  log.info(`Saving VO2 Max... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_cardio_score_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 皮膚温度データを DB に保存
 */
export async function saveTemperatureSkinDaily(
  raw: RawSchema,
  items: FitbitApiTemperatureSkinDay[],
): Promise<UpsertResult> {
  const records = toDbTemperatureSkinDaily(items);
  log.info(`Saving skin temperature... (${records.length} records)`);

  const result = await upsertBatch(raw, "fitbit_temperature_skin_daily", records, "date");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 全データを DB に保存（並列実行で高速化）
 */
export async function saveAllFitbitData(
  raw: RawSchema,
  data: FitbitData,
): Promise<{
  sleep: UpsertResult;
  activity: UpsertResult;
  heartRate: UpsertResult;
  hrv: UpsertResult;
  spo2: UpsertResult;
  breathingRate: UpsertResult;
  cardioScore: UpsertResult;
  temperatureSkin: UpsertResult;
}> {
  const [
    sleepResult,
    activityResult,
    heartRateResult,
    hrvResult,
    spo2Result,
    breathingRateResult,
    cardioScoreResult,
    temperatureSkinResult,
  ] = await Promise.all([
    saveSleep(raw, data.sleep),
    saveActivityDaily(raw, data.activity, data.azm),
    saveHeartRateDaily(raw, data.heartRate, data.heartRateIntraday),
    saveHrvDaily(raw, data.hrv),
    saveSpo2Daily(raw, data.spo2),
    saveBreathingRateDaily(raw, data.breathingRate),
    saveCardioScoreDaily(raw, data.cardioScore),
    saveTemperatureSkinDaily(raw, data.temperatureSkin),
  ]);

  return {
    sleep: sleepResult,
    activity: activityResult,
    heartRate: heartRateResult,
    hrv: hrvResult,
    spo2: spo2Result,
    breathingRate: breathingRateResult,
    cardioScore: cardioScoreResult,
    temperatureSkin: temperatureSkinResult,
  };
}
