// test/fitbit/manual/check_db.ts
// Supabase内のFitbitデータを確認
//
// 実行:
//   deno run --allow-env --allow-net --allow-read test/fitbit/manual/check_db.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCHEMA = "fitbit";

console.log("=".repeat(60));
console.log("Fitbit DB データ確認");
console.log("=".repeat(60));
console.log("");

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
  console.error("❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY が必要です");
  Deno.exit(1);
}

const supabase = createClient(url, key);

try {
  // 睡眠データ
  console.log("😴 睡眠データ (sleep):");
  const { data: sleepData, count: sleepCount } = await supabase
    .schema(SCHEMA)
    .from("sleep")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${sleepCount}件`);
  if (sleepData && sleepData.length > 0) {
    console.log("   最新3件:");
    for (const row of sleepData) {
      console.log(`     ${row.date} | ${row.minutes_asleep}分睡眠 | 効率${row.efficiency}% | ${row.is_main_sleep ? "メイン" : "昼寝"}`);
    }
  }
  console.log("");

  // 活動データ
  console.log("🚶 活動データ (activity_daily):");
  const { data: activityData, count: activityCount } = await supabase
    .schema(SCHEMA)
    .from("activity_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${activityCount}件`);
  if (activityData && activityData.length > 0) {
    console.log("   最新3件:");
    for (const row of activityData) {
      console.log(`     ${row.date} | ${row.steps}歩 | ${row.calories_total}kcal`);
    }
  }
  console.log("");

  // 心拍データ
  console.log("❤️  心拍データ (heart_rate_daily):");
  const { data: hrData, count: hrCount } = await supabase
    .schema(SCHEMA)
    .from("heart_rate_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${hrCount}件`);
  if (hrData && hrData.length > 0) {
    console.log("   最新3件:");
    for (const row of hrData) {
      console.log(`     ${row.date} | 安静時${row.resting_heart_rate ?? "N/A"}bpm`);
    }
  }
  console.log("");

  // HRVデータ
  console.log("📈 HRVデータ (hrv_daily):");
  const { data: hrvData, count: hrvCount } = await supabase
    .schema(SCHEMA)
    .from("hrv_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${hrvCount}件`);
  if (hrvData && hrvData.length > 0) {
    console.log("   最新3件:");
    for (const row of hrvData) {
      console.log(`     ${row.date} | Daily RMSSD=${row.daily_rmssd}ms | Deep RMSSD=${row.deep_rmssd}ms`);
    }
  }
  console.log("");

  // SpO2データ
  console.log("🫁 SpO2データ (spo2_daily):");
  const { data: spo2Data, count: spo2Count } = await supabase
    .schema(SCHEMA)
    .from("spo2_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${spo2Count}件`);
  if (spo2Data && spo2Data.length > 0) {
    console.log("   最新3件:");
    for (const row of spo2Data) {
      console.log(`     ${row.date} | 平均${row.avg_spo2}% (${row.min_spo2}-${row.max_spo2}%)`);
    }
  }
  console.log("");

  // 呼吸数データ
  console.log("🌬️  呼吸数データ (breathing_rate_daily):");
  const { data: brData, count: brCount } = await supabase
    .schema(SCHEMA)
    .from("breathing_rate_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${brCount}件`);
  if (brData && brData.length > 0) {
    console.log("   最新3件:");
    for (const row of brData) {
      console.log(`     ${row.date} | ${row.breathing_rate}回/分`);
    }
  }
  console.log("");

  // VO2 Maxデータ
  console.log("🏃 VO2 Maxデータ (cardio_score_daily):");
  const { data: vo2Data, count: vo2Count } = await supabase
    .schema(SCHEMA)
    .from("cardio_score_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${vo2Count}件`);
  if (vo2Data && vo2Data.length > 0) {
    console.log("   最新3件:");
    for (const row of vo2Data) {
      const range = row.vo2_max_range_low && row.vo2_max_range_high
        ? ` (${row.vo2_max_range_low}-${row.vo2_max_range_high})`
        : "";
      console.log(`     ${row.date} | VO2 Max=${row.vo2_max}${range}`);
    }
  }
  console.log("");

  // 皮膚温度データ
  console.log("🌡️  皮膚温度データ (temperature_skin_daily):");
  const { data: tempData, count: tempCount } = await supabase
    .schema(SCHEMA)
    .from("temperature_skin_daily")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .limit(3);

  console.log(`   総件数: ${tempCount}件`);
  if (tempData && tempData.length > 0) {
    console.log("   最新3件:");
    for (const row of tempData) {
      const sign = row.nightly_relative >= 0 ? "+" : "";
      console.log(`     ${row.date} | 相対値${sign}${row.nightly_relative}°`);
    }
  }
  console.log("");

  // トークン状態
  console.log("🔑 トークン状態 (tokens):");
  const { data: tokenData } = await supabase
    .schema(SCHEMA)
    .from("tokens")
    .select("id, expires_at, last_refreshed_at")
    .limit(1)
    .single();

  if (tokenData) {
    const expiresAt = new Date(tokenData.expires_at);
    const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60);
    const hoursUntilExpiry = minutesUntilExpiry / 60;
    
    console.log(`   有効期限: ${tokenData.expires_at}`);
    if (hoursUntilExpiry > 0) {
      console.log(`   残り: ${hoursUntilExpiry.toFixed(1)}時間`);
    } else {
      console.log(`   ⚠️  期限切れ（${Math.abs(hoursUntilExpiry).toFixed(1)}時間前）`);
    }
    console.log(`   最終リフレッシュ: ${tokenData.last_refreshed_at}`);
  } else {
    console.log("   トークンなし");
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("✅ 確認完了");
  console.log("=".repeat(60));
} catch (error) {
  console.error("");
  console.error("=".repeat(60));
  console.error("❌ 確認失敗");
  console.error(`   エラー: ${error instanceof Error ? error.message : error}`);
  console.error("=".repeat(60));
  Deno.exit(1);
}
