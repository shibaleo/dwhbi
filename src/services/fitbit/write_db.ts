// write_db.ts
// Fitbit データの Supabase 書き込み

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatFitbitDate } from "./api.ts";
import type {
  ActivitySummary,
  AzmDay,
  BreathingRateDay,
  CardioScoreDay,
  DbActivityDaily,
  DbBreathingRateDaily,
  DbCardioScoreDaily,
  DbHeartRateDaily,
  DbHrvDaily,
  DbSleep,
  DbSpo2Daily,
  DbTemperatureSkinDaily,
  FitbitData,
  HeartRateDay,
  HeartRateIntraday,
  HrvDay,
  SleepLog,
  Spo2ApiResponse,
  TemperatureSkinDay,
} from "./types.ts";

// ========== 定数 ==========

const SCHEMA = "fitbit";
const BATCH_SIZE = 100;

// ========== Supabase クライアント ==========

export function createFitbitDbClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY が必要です");
  }

  return createClient(url, key);
}

// ========== 変換関数: API → DB レコード ==========

/**
 * 睡眠データをDBレコードに変換
 */
export function toDbSleep(items: SleepLog[]): DbSleep[] {
  return items.map((item) => ({
    date: item.dateOfSleep,
    start_time: item.startTime,
    end_time: item.endTime,
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
 * 活動データをDBレコードに変換
 */
export function toDbActivityDaily(
  activityMap: Map<string, ActivitySummary>,
  azmData: AzmDay[],
  intradayMap?: Map<string, unknown>,
): DbActivityDaily[] {
  // AZMをMapに変換
  const azmMap = new Map<string, AzmDay>();
  for (const azm of azmData) {
    azmMap.set(azm.dateTime, azm);
  }

  const records: DbActivityDaily[] = [];

  for (const [date, summary] of activityMap) {
    // 距離を取得（総距離）
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
 * 心拍データをDBレコードに変換
 */
export function toDbHeartRateDaily(
  items: HeartRateDay[],
  intradayMap?: Map<string, HeartRateIntraday>,
): DbHeartRateDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    resting_heart_rate: item.value.restingHeartRate,
    heart_rate_zones: item.value.heartRateZones,
    intraday: intradayMap?.get(item.dateTime),
  }));
}

/**
 * HRVデータをDBレコードに変換
 */
export function toDbHrvDaily(items: HrvDay[]): DbHrvDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    daily_rmssd: item.value.dailyRmssd,
    deep_rmssd: item.value.deepRmssd,
    intraday: item.minutes,
  }));
}

/**
 * SpO2データをDBレコードに変換
 */
export function toDbSpo2Daily(
  spo2Map: Map<string, Spo2ApiResponse>,
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
 * 呼吸数データをDBレコードに変換
 */
export function toDbBreathingRateDaily(
  items: BreathingRateDay[],
): DbBreathingRateDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    breathing_rate: item.value.breathingRate,
  }));
}

/**
 * VO2 MaxデータをDBレコードに変換
 */
export function toDbCardioScoreDaily(
  items: CardioScoreDay[],
): DbCardioScoreDaily[] {
  return items.map((item) => {
    // VO2 Maxは "30-35" 形式または数値
    const vo2Value = item.value.vo2Max;
    let vo2Max: number | undefined;
    let vo2MaxRangeLow: number | undefined;
    let vo2MaxRangeHigh: number | undefined;

    if (vo2Value.includes("-")) {
      const [low, high] = vo2Value.split("-").map(Number);
      vo2MaxRangeLow = low;
      vo2MaxRangeHigh = high;
      vo2Max = (low + high) / 2; // 中央値
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
 * 皮膚温度データをDBレコードに変換
 */
export function toDbTemperatureSkinDaily(
  items: TemperatureSkinDay[],
): DbTemperatureSkinDaily[] {
  return items.map((item) => ({
    date: item.dateTime,
    nightly_relative: item.value.nightlyRelative,
    log_type: item.logType,
  }));
}

// ========== DB書き込み ==========

export interface UpsertResult {
  success: number;
  failed: number;
}

/**
 * バッチupsert
 */
async function upsertBatch<T extends object>(
  supabase: SupabaseClient,
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

    const { error } = await supabase
      .schema(SCHEMA)
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      console.error(
        `   ❌ バッチ ${Math.floor(i / BATCH_SIZE) + 1} エラー: ${error.message}`,
      );
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

/**
 * 睡眠データをDBに保存
 */
export async function saveSleep(
  supabase: SupabaseClient,
  items: SleepLog[],
): Promise<UpsertResult> {
  const records = toDbSleep(items);
  console.log(`💾 睡眠データ保存中... (${records.length}件)`);

  const result = await upsertBatch(supabase, "sleep", records, "log_id");

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * 活動データをDBに保存
 */
export async function saveActivityDaily(
  supabase: SupabaseClient,
  activityMap: Map<string, ActivitySummary>,
  azmData: AzmDay[],
): Promise<UpsertResult> {
  const records = toDbActivityDaily(activityMap, azmData);
  console.log(`💾 活動データ保存中... (${records.length}件)`);

  const result = await upsertBatch(supabase, "activity_daily", records, "date");

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * 心拍数データをDBに保存
 */
export async function saveHeartRateDaily(
  supabase: SupabaseClient,
  items: HeartRateDay[],
  intradayMap?: Map<string, HeartRateIntraday>,
): Promise<UpsertResult> {
  const records = toDbHeartRateDaily(items, intradayMap);
  console.log(`💾 心拍数データ保存中... (${records.length}件)`);

  const result = await upsertBatch(
    supabase,
    "heart_rate_daily",
    records,
    "date",
  );

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * HRVデータをDBに保存
 */
export async function saveHrvDaily(
  supabase: SupabaseClient,
  items: HrvDay[],
): Promise<UpsertResult> {
  const records = toDbHrvDaily(items);
  console.log(`💾 HRVデータ保存中... (${records.length}件)`);

  const result = await upsertBatch(supabase, "hrv_daily", records, "date");

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * SpO2データをDBに保存
 */
export async function saveSpo2Daily(
  supabase: SupabaseClient,
  spo2Map: Map<string, Spo2ApiResponse>,
): Promise<UpsertResult> {
  const records = toDbSpo2Daily(spo2Map);
  console.log(`💾 SpO2データ保存中... (${records.length}件)`);

  const result = await upsertBatch(supabase, "spo2_daily", records, "date");

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * 呼吸数データをDBに保存
 */
export async function saveBreathingRateDaily(
  supabase: SupabaseClient,
  items: BreathingRateDay[],
): Promise<UpsertResult> {
  const records = toDbBreathingRateDaily(items);
  console.log(`💾 呼吸数データ保存中... (${records.length}件)`);

  const result = await upsertBatch(
    supabase,
    "breathing_rate_daily",
    records,
    "date",
  );

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * VO2 MaxデータをDBに保存
 */
export async function saveCardioScoreDaily(
  supabase: SupabaseClient,
  items: CardioScoreDay[],
): Promise<UpsertResult> {
  const records = toDbCardioScoreDaily(items);
  console.log(`💾 VO2 Maxデータ保存中... (${records.length}件)`);

  const result = await upsertBatch(
    supabase,
    "cardio_score_daily",
    records,
    "date",
  );

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * 皮膚温度データをDBに保存
 */
export async function saveTemperatureSkinDaily(
  supabase: SupabaseClient,
  items: TemperatureSkinDay[],
): Promise<UpsertResult> {
  const records = toDbTemperatureSkinDaily(items);
  console.log(`💾 皮膚温度データ保存中... (${records.length}件)`);

  const result = await upsertBatch(
    supabase,
    "temperature_skin_daily",
    records,
    "date",
  );

  if (result.success > 0) console.log(`   ✓ ${result.success}件保存`);
  if (result.failed > 0) console.log(`   ✗ ${result.failed}件失敗`);

  return result;
}

/**
 * 全データをDBに保存（並列実行で高速化）
 */
export async function saveAllFitbitData(
  supabase: SupabaseClient,
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
  // 全テーブルへの保存を並列実行
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
    saveSleep(supabase, data.sleep),
    saveActivityDaily(supabase, data.activity, data.azm),
    saveHeartRateDaily(supabase, data.heartRate, data.heartRateIntraday),
    saveHrvDaily(supabase, data.hrv),
    saveSpo2Daily(supabase, data.spo2),
    saveBreathingRateDaily(supabase, data.breathingRate),
    saveCardioScoreDaily(supabase, data.cardioScore),
    saveTemperatureSkinDaily(supabase, data.temperatureSkin),
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
