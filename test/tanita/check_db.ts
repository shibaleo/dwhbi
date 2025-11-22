// test/tanita/check_db.ts
// DB内容の確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/tanita/check_db.ts
//
// 必要な環境変数:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@std/dotenv/load";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCHEMA = "tanita";

async function main() {
  console.log("=".repeat(60));
  console.log("Tanita DB データ確認");
  console.log("=".repeat(60));

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    console.error("\n❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY が必要です");
    Deno.exit(1);
  }

  const supabase = createClient(url, key);

  try {
    // 体組成データ
    console.log("\n📊 体組成データ (body_composition):");
    const { data: bodyData, count: bodyCount } = await supabase
      .schema(SCHEMA)
      .from("body_composition")
      .select("*", { count: "exact" })
      .order("measured_at", { ascending: false })
      .limit(5);

    console.log(`   総件数: ${bodyCount}件`);
    if (bodyData && bodyData.length > 0) {
      console.log("   最新5件:");
      for (const row of bodyData) {
        console.log(`     ${row.measured_at} | 体重=${row.weight}kg | 体脂肪=${row.body_fat_percent}%`);
      }
    }

    // 血圧データ
    console.log("\n📊 血圧データ (blood_pressure):");
    const { data: bpData, count: bpCount } = await supabase
      .schema(SCHEMA)
      .from("blood_pressure")
      .select("*", { count: "exact" })
      .order("measured_at", { ascending: false })
      .limit(5);

    console.log(`   総件数: ${bpCount}件`);
    if (bpData && bpData.length > 0) {
      console.log("   最新5件:");
      for (const row of bpData) {
        console.log(`     ${row.measured_at} | ${row.systolic}/${row.diastolic}mmHg | 脈拍=${row.pulse}bpm`);
      }
    }

    // 歩数データ
    console.log("\n📊 歩数データ (steps):");
    const { data: stepsData, count: stepsCount } = await supabase
      .schema(SCHEMA)
      .from("steps")
      .select("*", { count: "exact" })
      .order("measured_at", { ascending: false })
      .limit(5);

    console.log(`   総件数: ${stepsCount}件`);
    if (stepsData && stepsData.length > 0) {
      console.log("   最新5件:");
      for (const row of stepsData) {
        console.log(`     ${row.measured_at} | ${row.steps}歩`);
      }
    }

    // トークン状態
    console.log("\n🔑 トークン状態:");
    const { data: tokenData } = await supabase
      .schema(SCHEMA)
      .from("tokens")
      .select("expires_at, last_refreshed_at")
      .limit(1)
      .single();

    if (tokenData) {
      const expiresAt = new Date(tokenData.expires_at);
      const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

      console.log(`   有効期限: ${tokenData.expires_at}`);
      if (daysUntilExpiry > 0) {
        console.log(`   残り: ${daysUntilExpiry.toFixed(1)}日`);
      } else {
        console.log(`   ⚠️  期限切れ`);
      }
    } else {
      console.log("   トークンなし");
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ 確認完了");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
