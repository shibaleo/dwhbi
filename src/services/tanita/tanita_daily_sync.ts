// tanita_daily_sync.ts
// 過去30日分のTanitaデータを取得してSupabaseに保存（日次実行用）
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
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const HEIGHT_M = parseFloat(heightCm) / 100;

// 過去30日間のデータを取得
const now = new Date();
const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
const fromStr = formatTanitaDate(from);
const toStr = formatTanitaDate(now);

console.log("🔄 Tanita Health Planet 日次同期開始");
console.log(`📅 期間: ${from.toISOString().split('T')[0]} 〜 ${now.toISOString().split('T')[0]}`);
console.log(`📏 身長: ${heightCm}cm\n`);

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

// 2. 体組成データ取得
console.log("\n🏋️  体組成データ取得中...");
const innerscanData = await fetchTanitaData(
  "innerscan",
  tokenData.access_token,
  fromStr,
  toStr,
  "6021,6022"
);
console.log(`   取得: ${innerscanData.data?.length || 0}件`);

let bodyMetricsCount = 0;
if (innerscanData.data && innerscanData.data.length > 0) {
  bodyMetricsCount = await saveBodyMetrics(innerscanData.data);
}

await sleep(1000);

// 3. 血圧データ取得
console.log("\n🩺 血圧データ取得中...");
const bpData = await fetchTanitaData(
  "sphygmomanometer",
  tokenData.access_token,
  fromStr,
  toStr,
  "622E,622F,6230"
);
console.log(`   取得: ${bpData.data?.length || 0}件`);

let bloodPressureCount = 0;
if (bpData.data && bpData.data.length > 0) {
  bloodPressureCount = await saveBloodPressure(bpData.data);
}

console.log("\n" + "=".repeat(60));
console.log("✅ 同期完了");
console.log(`   体組成データ: ${bodyMetricsCount}日分`);
console.log(`   血圧データ: ${bloodPressureCount}件`);
console.log("=".repeat(60));

// ========== ヘルパー関数 ==========

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
    if (record.weight_kg) {
      record.bmi = parseFloat(calculateBMI(record.weight_kg).toFixed(1));
    }

    const { error } = await supabase
      .from("body_metrics_daily")
      .upsert(record, { onConflict: "date" });

    if (!error) {
      savedCount++;
      console.log(`   ✓ ${record.date}`);
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
    const { error } = await supabase
      .from("blood_pressure_records")
      .upsert(record, { onConflict: "measured_at,source" });

    if (!error) {
      savedCount++;
      console.log(`   ✓ ${record.measured_at}`);
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
  
  // TanitaのデータはJST（UTC+9）なので、UTC時刻に変換
  // JST 07:43 = UTC 22:43（前日） なので、9時間引く
  return new Date(Date.UTC(year, month, day, hour - 9, minute));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}