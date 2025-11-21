/**
 * FitbitデータをSupabaseへ同期するプログラム
 * 
 * 使用法:
 *   deno run --allow-all sync_fitbit_to_supabase.ts [開始日] [終了日]
 *   
 * 例:
 *   deno run --allow-all sync_fitbit_to_supabase.ts 2025-01-01 2025-01-31
 */
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =========================================
// 型定義
// =========================================

interface FitbitAllScopeData {
  date?: string; // YYYY-MM-DD形式
  sleep?: any[];
  heartRate?: any[];
  activitySteps?: any[];
  activityDistance?: any[];
  activityCalories?: any[];
  activityFloors?: any[];
  activityElevation?: any[];
  activityMinutesSedentary?: any[];
  activityMinutesLightlyActive?: any[];
  activityMinutesFairlyActive?: any[];
  activityMinutesVeryActive?: any[];
  bodyWeight?: any[];
  bodyFat?: any[];
  spO2?: any[];
}

interface CachedAllScopeData {
  date: string;
  data: FitbitAllScopeData;
}

// =========================================
// Supabase設定
// =========================================

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase接続情報が設定されていません");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// =========================================
// データ変換関数
// =========================================

/**
 * 体重・体脂肪率・BMIデータを変換
 */
function transformBodyMetrics(date: string, data: FitbitAllScopeData) {
  const weight = data.bodyWeight?.[0]?.value;
  const bodyFat = data.bodyFat?.[0]?.value;
  const bmi = data.bodyFat?.[0]?.bmi || (data.bodyWeight as any)?.[0]?.bmi;

  if (!weight && !bodyFat && !bmi) return null;

  return {
    date,
    weight_kg: weight ? parseFloat(weight) : null,
    body_fat_percent: bodyFat ? parseFloat(bodyFat) : null,
    bmi: bmi ? parseFloat(bmi) : null,
    source: "fitbit",
    synced_at: new Date().toISOString(),
  };
}

/**
 * 睡眠データを変換
 */
function transformSleepRecords(date: string, data: FitbitAllScopeData) {
  if (!data.sleep || data.sleep.length === 0) return [];

  return data.sleep.map((sleep: any) => {
    const levels = sleep.levels?.summary;
    return {
      date,
      start_time: sleep.startTime,
      end_time: sleep.endTime,
      total_minutes: sleep.duration ? Math.floor(sleep.duration / 60000) : sleep.timeInBed,
      deep_minutes: levels?.deep?.minutes || null,
      light_minutes: levels?.light?.minutes || null,
      rem_minutes: levels?.rem?.minutes || null,
      awake_minutes: levels?.wake?.minutes || levels?.awake?.minutes || null,
      efficiency_percent: sleep.efficiency || null,
      is_main_sleep: sleep.isMainSleep !== undefined ? sleep.isMainSleep : true,
      time_in_bed_minutes: sleep.timeInBed || null,
      minutes_to_fall_asleep: sleep.minutesToFallAsleep || null,
      sleep_type: sleep.type || null,
      metadata: sleep.levels || null,
      source: "fitbit",
      synced_at: new Date().toISOString(),
    };
  });
}

/**
 * 心拍数データを変換
 */
function transformHeartRate(date: string, data: FitbitAllScopeData) {
  if (!data.heartRate || data.heartRate.length === 0) return null;

  const hr = data.heartRate[0];
  const restingHR = hr.value?.restingHeartRate;
  const zones = hr.value?.heartRateZones;

  if (!restingHR && !zones) return null;

  return {
    date,
    resting_heart_rate: restingHR || null,
    out_of_range_minutes: zones?.find((z: any) => z.name === "Out of Range")?.minutes || null,
    fat_burn_minutes: zones?.find((z: any) => z.name === "Fat Burn")?.minutes || null,
    cardio_minutes: zones?.find((z: any) => z.name === "Cardio")?.minutes || null,
    peak_minutes: zones?.find((z: any) => z.name === "Peak")?.minutes || null,
    heart_rate_zones: zones || null,
    source: "fitbit",
    synced_at: new Date().toISOString(),
  };
}

/**
 * 活動量サマリーを変換
 */
function transformActivitySummary(date: string, data: FitbitAllScopeData) {
  const steps = data.activitySteps?.[0]?.value;
  const distance = data.activityDistance?.[0]?.value;
  const calories = data.activityCalories?.[0]?.value;
  const floors = data.activityFloors?.[0]?.value;
  const elevation = data.activityElevation?.[0]?.value;
  const sedentary = data.activityMinutesSedentary?.[0]?.value;
  const lightly = data.activityMinutesLightlyActive?.[0]?.value;
  const fairly = data.activityMinutesFairlyActive?.[0]?.value;
  const very = data.activityMinutesVeryActive?.[0]?.value;

  // すべてがnullの場合はスキップ
  if (!steps && !distance && !calories && !floors && !elevation &&
      !sedentary && !lightly && !fairly && !very) {
    return null;
  }

  return {
    date,
    steps: steps ? parseInt(steps) : null,
    distance_meters: distance ? Math.round(parseFloat(distance) * 1000) : null, // kmをメートルに変換
    calories_burned: calories ? parseInt(calories) : null,
    floors: floors ? parseInt(floors) : null,
    elevation_meters: elevation ? parseFloat(elevation) : null,
    sedentary_minutes: sedentary ? parseInt(sedentary) : null,
    lightly_active_minutes: lightly ? parseInt(lightly) : null,
    fairly_active_minutes: fairly ? parseInt(fairly) : null,
    very_active_minutes: very ? parseInt(very) : null,
    source: "fitbit",
    synced_at: new Date().toISOString(),
  };
}

/**
 * SpO2データを変換
 */
function transformSpO2(date: string, data: FitbitAllScopeData) {
  if (!data.spO2 || data.spO2.length === 0) return null;

  const spo2 = data.spO2[0];
  const value = spo2.value?.avg || spo2.value;

  if (!value) return null;

  return {
    date,
    spo2_percent: parseFloat(value),
    spo2_min: spo2.value?.min ? parseFloat(spo2.value.min) : null,
    spo2_max: spo2.value?.max ? parseFloat(spo2.value.max) : null,
    source: "fitbit",
    synced_at: new Date().toISOString(),
  };
}

// =========================================
// Supabaseアップサート関数
// =========================================

async function upsertToSupabase(
  tableName: string,
  data: any | any[],
  uniqueColumns: string[]
) {
  if (!data || (Array.isArray(data) && data.length === 0)) {
    console.log(`  ⏭️  ${tableName}: スキップ（データなし）`);
    return { success: true, count: 0 };
  }

  const records = Array.isArray(data) ? data : [data];

  try {
    const { error, count } = await supabase
      .from(tableName)
      .upsert(records, {
        onConflict: uniqueColumns.join(","),
        ignoreDuplicates: false, // 重複時は更新
      })
      .select();

    if (error) {
      console.error(`  ❌ ${tableName}: エラー`, error.message);
      return { success: false, count: 0 };
    }

    console.log(`  ✅ ${tableName}: ${records.length}件 upsert完了`);
    return { success: true, count: records.length };
  } catch (err) {
    console.error(`  ❌ ${tableName}: 例外発生`, err);
    return { success: false, count: 0 };
  }
}

// =========================================
// メイン同期処理
// =========================================

async function syncFitbitDataToSupabase(cachedData: CachedAllScopeData[]) {
  console.log(`\n📊 Supabaseへの同期を開始します（${cachedData.length}日分）\n`);

  let totalStats = {
    bodyMetrics: 0,
    sleep: 0,
    heartRate: 0,
    activity: 0,
    spo2: 0,
  };

  for (const { date, data } of cachedData) {
    console.log(`📅 ${date}:`);

    // 1. 体重・体脂肪率・BMI
    const bodyMetrics = transformBodyMetrics(date, data);
    const bodyResult = await upsertToSupabase("body_metrics_daily", bodyMetrics, ["date"]);
    if (bodyResult.success) totalStats.bodyMetrics += bodyResult.count;

    // 2. 睡眠記録
    const sleepRecords = transformSleepRecords(date, data);
    const sleepResult = await upsertToSupabase("sleep_records", sleepRecords, ["date", "start_time"]);
    if (sleepResult.success) totalStats.sleep += sleepResult.count;

    // 3. 心拍数
    const heartRate = transformHeartRate(date, data);
    const hrResult = await upsertToSupabase("heart_rate_daily", heartRate, ["date"]);
    if (hrResult.success) totalStats.heartRate += hrResult.count;

    // 4. 活動量サマリー
    const activity = transformActivitySummary(date, data);
    const activityResult = await upsertToSupabase("activity_summary_daily", activity, ["date"]);
    if (activityResult.success) totalStats.activity += activityResult.count;

    // 5. SpO2
    const spo2 = transformSpO2(date, data);
    const spo2Result = await upsertToSupabase("spo2_daily", spo2, ["date"]);
    if (spo2Result.success) totalStats.spo2 += spo2Result.count;

    console.log(""); // 空行
  }

  // サマリー出力
  console.log("=".repeat(60));
  console.log("📈 同期完了サマリー:");
  console.log(`  体重・体脂肪・BMI: ${totalStats.bodyMetrics}件`);
  console.log(`  睡眠記録: ${totalStats.sleep}件`);
  console.log(`  心拍数: ${totalStats.heartRate}件`);
  console.log(`  活動量: ${totalStats.activity}件`);
  console.log(`  SpO2: ${totalStats.spo2}件`);
  console.log("=".repeat(60));
}

// =========================================
// キャッシュ読み込み関数
// =========================================

async function loadCachedDataFromDirectory(startDate: string, endDate: string): Promise<CachedAllScopeData[]> {
  const cacheDir = "./cache";
  const start = new Date(startDate);
  const end = new Date(endDate);
  const results: CachedAllScopeData[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const filePath = `${cacheDir}/${dateStr}.json`;

    try {
      const text = await Deno.readTextFile(filePath);
      const cached: CachedAllScopeData = JSON.parse(text);
      results.push(cached);
    } catch (err) {
      console.warn(`⚠️  キャッシュなし: ${dateStr}`);
    }
  }

  if (results.length === 0) {
    throw new Error("読み込めるキャッシュがありません。先にfetch_fitbit_data.tsを実行してください。");
  }

  return results;
}

// =========================================
// CLI実行
// =========================================

if (import.meta.main) {
  try {
    const args = Deno.args;

    // デフォルトは過去7日間
    const endDate = args[1] || new Date().toISOString().split("T")[0];
    const startDate = args[0] || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d.toISOString().split("T")[0];
    })();

    console.log(`📥 キャッシュを読み込んでいます: ${startDate} 〜 ${endDate}`);
    const cachedData = await loadCachedDataFromDirectory(startDate, endDate);

    console.log(`✅ ${cachedData.length}日分のキャッシュを読み込みました`);

    await syncFitbitDataToSupabase(cachedData);

    console.log("\n✨ 同期が完了しました");
  } catch (error) {
    console.error("\n❌ エラーが発生しました:", error.message);
    Deno.exit(1);
  }
}