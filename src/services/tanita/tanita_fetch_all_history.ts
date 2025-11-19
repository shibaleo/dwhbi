// tanita_fetch_all_history.ts
// 2025-03-01からの全データを取得してSupabaseに保存（BMI自動計算付き）
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const heightCm = Deno.env.get("HEIGHT_CM");

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase接続情報が設定されていません");
  Deno.exit(1);
}

if (!heightCm) {
  console.error("❌ HEIGHT_CM環境変数が設定されていません");
  console.error("   例: export HEIGHT_CM=167.5");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 身長設定（メートル単位に変換）
const HEIGHT_M = parseFloat(heightCm) / 100;

if (isNaN(HEIGHT_M) || HEIGHT_M <= 0) {
  console.error("❌ HEIGHT_CMが無効な値です:", heightCm);
  Deno.exit(1);
}

// 開始日
const START_DATE = new Date("2025-03-01");
const now = new Date();

// 1. アクセストークン取得
console.log("📥 アクセストークンを取得中...");
const { data: tokenData, error: tokenError } = await supabase
  .from("tanita_tokens")
  .select("access_token")
  .limit(1)
  .single();

if (tokenError || !tokenData) {
  console.error("❌ トークン取得エラー:", tokenError?.message);
  Deno.exit(1);
}

// 2. 3ヶ月ごとの期間を生成
const periods = generatePeriods(START_DATE, now);
console.log(`\n📅 取得期間: ${periods.length}期間（3ヶ月ずつ）`);
console.log(`   合計API呼び出し: ${periods.length * 2}回（Rate limit: 60回/時間）`);
console.log(`   身長: ${heightCm}cm（BMI自動計算）\n`);

let totalBodyMetrics = 0;
let totalBloodPressure = 0;
let apiCallCount = 0;

// 3. 各期間のデータを取得
for (let i = 0; i < periods.length; i++) {
  const period = periods[i];
  console.log(`\n━━━ 期間 ${i + 1}/${periods.length}: ${period.from} 〜 ${period.to} ━━━`);

  // 体組成データ取得
  console.log("🏋️  体組成データ取得中...");
  const innerscanData = await fetchTanitaData(
    "innerscan",
    tokenData.access_token,
    period.from,
    period.to,
    "6021,6022"
  );
  apiCallCount++;
  console.log(`   取得: ${innerscanData.data?.length || 0}件`);

  if (innerscanData.data && innerscanData.data.length > 0) {
    const saved = await saveBodyMetrics(innerscanData.data);
    totalBodyMetrics += saved;
  }

  // 少し待機（API負荷軽減）
  await sleep(1000);

  // 血圧データ取得
  console.log("🩺 血圧データ取得中...");
  const bpData = await fetchTanitaData(
    "sphygmomanometer",
    tokenData.access_token,
    period.from,
    period.to,
    "622E,622F,6230"
  );
  apiCallCount++;
  console.log(`   取得: ${bpData.data?.length || 0}件`);

  if (bpData.data && bpData.data.length > 0) {
    const saved = await saveBloodPressure(bpData.data);
    totalBloodPressure += saved;
  }

  // 期間間の待機（次の期間まで2秒）
  if (i < periods.length - 1) {
    await sleep(2000);
  }
}

console.log("\n" + "=".repeat(60));
console.log("✅ 全データ取得完了！");
console.log(`   API呼び出し回数: ${apiCallCount}回`);
console.log(`   体組成データ保存: ${totalBodyMetrics}日分`);
console.log(`   血圧データ保存: ${totalBloodPressure}件`);
console.log("=".repeat(60));

// ========== ヘルパー関数 ==========

function generatePeriods(start: Date, end: Date) {
  const periods = [];
  let current = new Date(start);

  while (current < end) {
    const periodEnd = new Date(current);
    periodEnd.setMonth(periodEnd.getMonth() + 3);
    
    // 最後の期間は現在時刻まで
    if (periodEnd > end) {
      periodEnd.setTime(end.getTime());
    }

    periods.push({
      from: formatTanitaDate(current),
      to: formatTanitaDate(periodEnd),
    });

    current = new Date(periodEnd);
    current.setDate(current.getDate() + 1); // 次の日から開始
  }

  return periods;
}

function formatTanitaDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}000000`;
}

async function fetchTanitaData(
  scope: string,
  accessToken: string,
  from: string,
  to: string,
  tag: string
) {
  const url = `https://www.healthplanet.jp/status/${scope}.json`;
  const params = new URLSearchParams({
    access_token: accessToken,
    date: "1",
    from: from,
    to: to,
    tag: tag,
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    console.error(`   ❌ エラー: ${response.status}`);
    const text = await response.text();
    console.error(text);
    return { data: [] };
  }

  return await response.json();
}

function calculateBMI(weightKg: number): number {
  // BMI = 体重(kg) / 身長(m)^2
  return weightKg / (HEIGHT_M * HEIGHT_M);
}

async function saveBodyMetrics(data: any[]): Promise<number> {
  const byDate: { [key: string]: any } = {};

  for (const item of data) {
    const date = parseTanitaDate(item.date);
    const dateKey = date.toISOString().split("T")[0];

    if (!byDate[dateKey]) {
      byDate[dateKey] = { date: dateKey, source: "tanita" };
    }

    if (item.tag === "6021") {
      byDate[dateKey].weight_kg = parseFloat(item.keydata);
    } else if (item.tag === "6022") {
      byDate[dateKey].body_fat_percent = parseFloat(item.keydata);
    }
  }

  let savedCount = 0;
  for (const record of Object.values(byDate)) {
    // 体重がある場合はBMIを計算
    if (record.weight_kg) {
      record.bmi = parseFloat(calculateBMI(record.weight_kg).toFixed(1));
    }

    const { error } = await supabase
      .from("body_metrics_daily")
      .upsert(record, { onConflict: "date" });

    if (!error) {
      savedCount++;
      const bmiStr = record.bmi ? `, BMI: ${record.bmi}` : '';
      console.log(`   ✓ ${record.date} (体重: ${record.weight_kg}kg, 体脂肪率: ${record.body_fat_percent}%${bmiStr})`);
    } else {
      console.error(`   ⚠️  ${record.date} エラー:`, error.message);
    }
  }

  return savedCount;
}

async function saveBloodPressure(data: any[]): Promise<number> {
  const byTimestamp: { [key: string]: any } = {};

  for (const item of data) {
    const measuredAt = parseTanitaDate(item.date);
    const timestampKey = measuredAt.toISOString();

    if (!byTimestamp[timestampKey]) {
      byTimestamp[timestampKey] = {
        measured_at: timestampKey,
        source: "tanita",
      };
    }

    if (item.tag === "622E") {
      byTimestamp[timestampKey].systolic = parseInt(item.keydata);
    } else if (item.tag === "622F") {
      byTimestamp[timestampKey].diastolic = parseInt(item.keydata);
    } else if (item.tag === "6230") {
      byTimestamp[timestampKey].pulse = parseInt(item.keydata);
    }
  }

  let savedCount = 0;
  for (const record of Object.values(byTimestamp)) {
    const { data: existing } = await supabase
      .from("blood_pressure_records")
      .select("id")
      .eq("measured_at", record.measured_at)
      .eq("source", "tanita")
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabase
      .from("blood_pressure_records")
      .insert(record);

    if (!error) {
      savedCount++;
      console.log(`   ✓ ${record.measured_at} (${record.systolic}/${record.diastolic} mmHg, 脈拍: ${record.pulse} bpm)`);
    }
  }

  return savedCount;
}

function parseTanitaDate(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  const hour = parseInt(dateStr.substring(8, 10));
  const minute = parseInt(dateStr.substring(10, 12));
  return new Date(year, month, day, hour, minute);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}