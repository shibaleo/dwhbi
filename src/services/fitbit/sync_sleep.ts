// sync_sleep.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refreshFitbitToken, FitbitTokenData } from "./refresh_fitbit_token.ts";

interface FitbitSleepLevel {
  deep?: { count: number; minutes: number; thirtyDayAvgMinutes?: number };
  light?: { count: number; minutes: number; thirtyDayAvgMinutes?: number };
  rem?: { count: number; minutes: number; thirtyDayAvgMinutes?: number };
  wake?: { count: number; minutes: number; thirtyDayAvgMinutes?: number };
}

interface FitbitSleepLog {
  dateOfSleep: string;
  startTime: string;
  endTime: string;
  duration: number;
  efficiency: number;
  isMainSleep: boolean;
  levels: {
    summary: FitbitSleepLevel;
    data?: Array<{
      dateTime: string;
      level: string;
      seconds: number;
    }>;
  };
  minutesToFallAsleep: number;
  timeInBed: number;
  type: string;
  infoCode?: number;
  logId: number;
}

interface FitbitSleepResponse {
  sleep: FitbitSleepLog[];
  summary?: {
    totalMinutesAsleep: number;
    totalSleepRecords: number;
    totalTimeInBed: number;
  };
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function fetchSleepDataRange(
  startDate: string,
  endDate: string,
  token: FitbitTokenData
): Promise<FitbitSleepLog[]> {
  console.log(`\n📥 Fetching sleep data from ${startDate} to ${endDate}...`);
  
  // Fitbit Sleep API: 日付範囲で取得
  const response = await fetch(
    `https://api.fitbit.com/1.2/user/-/sleep/date/${startDate}/${endDate}.json`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Fitbit API error: ${response.status} ${await response.text()}`
    );
  }

  const data: FitbitSleepResponse = await response.json();

  if (!data.sleep || data.sleep.length === 0) {
    console.log(`   ⚠️  No sleep data found`);
    return [];
  }

  console.log(`   ✅ Fetched ${data.sleep.length} sleep record(s)`);
  
  // 日付ごとの内訳を表示
  const recordsByDate = data.sleep.reduce((acc, log) => {
    acc[log.dateOfSleep] = (acc[log.dateOfSleep] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [date, count] of Object.entries(recordsByDate)) {
    console.log(`      ${date}: ${count} record(s)`);
  }

  return data.sleep;
}

async function insertAllSleepData(
  sleepLogs: FitbitSleepLog[],
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<{ inserted: number; skipped: number; errors: number }> {
  console.log(`\n💾 Inserting ${sleepLogs.length} sleep records into Supabase...`);
  
  if (sleepLogs.length === 0) {
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  // Step 1: 既存レコードを一括取得
  console.log(`   📊 Checking for existing records...`);
  
  const dateRange = [
    ...new Set(sleepLogs.map((log) => log.dateOfSleep)),
  ];
  
  const { data: existingRecords, error: fetchError } = await supabase
    .from("sleep_records")
    .select("date, start_time")
    .in("date", dateRange);

  if (fetchError) {
    throw new Error(`Failed to fetch existing records: ${fetchError.message}`);
  }

  // 既存レコードのキーセットを作成
  const existingKeys = new Set(
    (existingRecords || []).map((record) => `${record.date}|${record.start_time}`)
  );

  console.log(`      Found ${existingKeys.size} existing record(s)`);

  // Step 2: 新規レコードのみをフィルタリング
  const newRecords = sleepLogs
    .filter((sleep) => {
      const key = `${sleep.dateOfSleep}|${sleep.startTime}`;
      return !existingKeys.has(key);
    })
    .map((sleep) => ({
      date: sleep.dateOfSleep,
      start_time: sleep.startTime,
      end_time: sleep.endTime,
      total_minutes: sleep.duration / 60000, // ミリ秒を分に変換
      deep_minutes: sleep.levels.summary.deep?.minutes,
      light_minutes: sleep.levels.summary.light?.minutes,
      rem_minutes: sleep.levels.summary.rem?.minutes,
      awake_minutes: sleep.levels.summary.wake?.minutes,
      efficiency_percent: sleep.efficiency,
      is_main_sleep: sleep.isMainSleep,
      time_in_bed_minutes: sleep.timeInBed,
      minutes_to_fall_asleep: sleep.minutesToFallAsleep,
      sleep_type: sleep.type,
      metadata: {
        logId: sleep.logId,
        infoCode: sleep.infoCode,
        levels_data: sleep.levels.data,
      },
      source: "fitbit",
      synced_at: new Date().toISOString(),
    }));

  const skippedCount = sleepLogs.length - newRecords.length;
  
  console.log(`      ${newRecords.length} new record(s) to insert`);
  console.log(`      ${skippedCount} record(s) already exist (skipped)`);

  if (newRecords.length === 0) {
    console.log(`   ✅ All records already exist, nothing to insert`);
    return { inserted: 0, skipped: skippedCount, errors: 0 };
  }

  // Step 3: 新規レコードを一括挿入
  console.log(`   💿 Bulk inserting ${newRecords.length} record(s)...`);
  
  const { error: insertError, count } = await supabase
    .from("sleep_records")
    .insert(newRecords)
    .select("id", { count: "exact" });

  if (insertError) {
    throw new Error(`Bulk insert failed: ${insertError.message}`);
  }

  const insertedCount = count || newRecords.length;
  
  console.log(`   ✅ Successfully inserted ${insertedCount} record(s)`);

  return {
    inserted: insertedCount,
    skipped: skippedCount,
    errors: 0,
  };
}

async function syncSleepRange(startDate: string, endDate: string) {
  console.log(`\n🌙 Sleep Data Sync: ${startDate} to ${endDate}`);
  console.log("=".repeat(60));

  // Step 1: トークンを1回だけ取得
  console.log("\n🔑 Step 1: Acquiring Fitbit access token...");
  const token = await refreshFitbitToken();
  console.log("   ✅ Token acquired");

  // Step 2: 日付範囲のデータを1回のAPIリクエストで取得
  console.log("\n📡 Step 2: Fetching data from Fitbit API");
  const sleepLogs = await fetchSleepDataRange(startDate, endDate, token);

  if (sleepLogs.length === 0) {
    console.log("\n⚠️  No sleep data found in the specified date range");
    return;
  }

  // Step 3: Supabaseクライアントを初期化
  console.log("\n🗄️  Step 3: Connecting to Supabase...");
  const supabase = getSupabaseClient();
  console.log("   ✅ Connected");

  // Step 4: すべてのデータを一括処理でSupabaseに挿入
  console.log("\n💿 Step 4: Inserting data into database");
  const result = await insertAllSleepData(sleepLogs, supabase);

  console.log("\n" + "=".repeat(60));
  console.log(`✅ Sync complete:`);
  console.log(`   • ${result.inserted} records inserted`);
  console.log(`   • ${result.skipped} records skipped (already exist)`);
  if (result.errors > 0) {
    console.log(`   • ${result.errors} errors encountered`);
  }
}

async function syncSingleDate(date: string) {
  // 単一日付の場合も同じ関数を使用
  await syncSleepRange(date, date);
}

// メイン実行
if (import.meta.main) {
  const args = Deno.args;

  try {
    if (args.length === 0) {
      // 引数なし: 過去7日間を同期
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      await syncSleepRange(
        startDate.toISOString().split("T")[0],
        endDate.toISOString().split("T")[0]
      );
    } else if (args.length === 1) {
      // 1つの日付を同期
      await syncSingleDate(args[0]);
    } else if (args.length === 2) {
      // 日付範囲を同期
      await syncSleepRange(args[0], args[1]);
    } else {
      console.log("Usage:");
      console.log("  deno run --allow-all sync_sleep.ts                  # Sync last 7 days");
      console.log("  deno run --allow-all sync_sleep.ts 2025-01-15      # Sync specific date");
      console.log(
        "  deno run --allow-all sync_sleep.ts 2025-01-01 2025-01-31  # Sync date range"
      );
      Deno.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    Deno.exit(1);
  }
}

export { syncSleepRange, syncSingleDate, fetchSleepDataRange, insertAllSleepData };