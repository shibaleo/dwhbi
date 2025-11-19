// tanita_fetch_and_save.ts
// Tanita Health Planet APIからデータ取得 → Supabase保存
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// 環境変数取得
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase接続情報が設定されていません");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 1. Supabaseからアクセストークン取得
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

// 日付範囲設定（過去30日間）
const now = new Date();
const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
const fromStr = formatTanitaDate(from);
const toStr = formatTanitaDate(now);

console.log(`📅 取得期間: ${fromStr} 〜 ${toStr}`);

// 2. 体組成データ取得（innerscan）
console.log("\n🏋️ 体組成データを取得中...");
const innerscanData = await fetchTanitaData(
  "innerscan",
  tokenData.access_token,
  fromStr,
  toStr,
  "6021,6022" // 体重、体脂肪率
);

console.log(`   取得件数: ${innerscanData.data?.length || 0}件`);

// 3. 血圧データ取得（sphygmomanometer）
console.log("\n🩺 血圧データを取得中...");
const bpData = await fetchTanitaData(
  "sphygmomanometer",
  tokenData.access_token,
  fromStr,
  toStr,
  "622E,622F,6230" // 最高血圧、最低血圧、脈拍
);

console.log(`   取得件数: ${bpData.data?.length || 0}件`);

// 4. 体組成データをSupabaseに保存
if (innerscanData.data && innerscanData.data.length > 0) {
  console.log("\n💾 体組成データをSupabaseに保存中...");
  await saveBodyMetrics(innerscanData.data);
}

// 5. 血圧データをSupabaseに保存
if (bpData.data && bpData.data.length > 0) {
  console.log("\n💾 血圧データをSupabaseに保存中...");
  await saveBloodPressure(bpData.data);
}

console.log("\n✅ 完了！");

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
    date: "1", // 測定日付
    from: from,
    to: to,
  });

  if (tag) {
    params.append("tag", tag);
  }

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    console.error(`❌ ${scope} データ取得エラー: ${response.status}`);
    const text = await response.text();
    console.error(text);
    return { data: [] };
  }

  return await response.json();
}

async function saveBodyMetrics(data: any[]) {
  // 日付ごとにグループ化
  const byDate: { [key: string]: any } = {};

  for (const item of data) {
    const date = parseTanitaDate(item.date);
    const dateKey = date.toISOString().split("T")[0];

    if (!byDate[dateKey]) {
      byDate[dateKey] = {
        date: dateKey,
        source: "tanita",
      };
    }

    // タグによって振り分け
    if (item.tag === "6021") {
      byDate[dateKey].weight_kg = parseFloat(item.keydata);
    } else if (item.tag === "6022") {
      byDate[dateKey].body_fat_percent = parseFloat(item.keydata);
    }
  }

  // Supabaseに保存（upsert）
  for (const record of Object.values(byDate)) {
    const { error } = await supabase
      .from("body_metrics_daily")
      .upsert(record, {
        onConflict: "date",
      });

    if (error) {
      console.error(`   ⚠️  ${record.date} 保存エラー:`, error.message);
    } else {
      console.log(`   ✓ ${record.date} 保存完了 (体重: ${record.weight_kg}kg, 体脂肪率: ${record.body_fat_percent}%)`);
    }
  }
}

async function saveBloodPressure(data: any[]) {
  // 測定時刻ごとにグループ化
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

    // タグによって振り分け
    if (item.tag === "622E") {
      byTimestamp[timestampKey].systolic = parseInt(item.keydata);
    } else if (item.tag === "622F") {
      byTimestamp[timestampKey].diastolic = parseInt(item.keydata);
    } else if (item.tag === "6230") {
      byTimestamp[timestampKey].pulse = parseInt(item.keydata);
    }
  }

  // Supabaseに保存（insert）
  for (const record of Object.values(byTimestamp)) {
    // 既存レコードをチェック
    const { data: existing } = await supabase
      .from("blood_pressure_records")
      .select("id")
      .eq("measured_at", record.measured_at)
      .eq("source", "tanita")
      .maybeSingle();

    if (existing) {
      console.log(`   ⤵ ${record.measured_at} スキップ（既存）`);
      continue;
    }

    const { error } = await supabase
      .from("blood_pressure_records")
      .insert(record);

    if (error) {
      console.error(`   ⚠️  ${record.measured_at} 保存エラー:`, error.message);
    } else {
      console.log(`   ✓ ${record.measured_at} 保存完了 (${record.systolic}/${record.diastolic} mmHg, 脈拍: ${record.pulse} bpm)`);
    }
  }
}

function parseTanitaDate(dateStr: string): Date {
  // YYYYMMDDHHmm形式をパース
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  const hour = parseInt(dateStr.substring(8, 10));
  const minute = parseInt(dateStr.substring(10, 12));

  return new Date(year, month, day, hour, minute);
}