// example.ts - Fitbit APIの使用例

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { getFitbitData } from "./api.ts";
import { fetchFitbitData } from "./fetch.ts";

// ========================================
// 例1: キャッシュ優先で取得（推奨）
// ========================================
async function example1_cacheFirst() {
  console.log("=== Example 1: Cache-first retrieval ===\n");
  
  // キャッシュがあれば即座に返す（トークン取得なし）
  // キャッシュがなければAPI取得
  const data = await getFitbitData("2025-01-01", "2025-01-31");
  
  console.log(`\n取得したチャンク数: ${data.length}`);
  
  // データの中身を確認
  for (const chunk of data) {
    console.log(`\nチャンク: ${chunk.dateRange.start} to ${chunk.dateRange.end}`);
    console.log(`  Sleep: ${chunk.sleep.length} records`);
    console.log(`  Heart Rate: ${chunk.heartRate.length} records`);
    console.log(`  Activity: ${chunk.activity.length} records`);
  }
}

// ========================================
// 例2: 強制的にAPI取得
// ========================================
async function example2_forceRefresh() {
  console.log("=== Example 2: Force refresh from API ===\n");
  
  // キャッシュを無視して強制取得
  const data = await fetchFitbitData("2025-01-01", "2025-01-07", {
    forceRefresh: true,
  });
  
  console.log(`\n取得したチャンク数: ${data.length}`);
}

// ========================================
// 例3: Supabase同期処理のイメージ
// ========================================
async function example3_supabaseSync() {
  console.log("=== Example 3: Supabase sync (mock) ===\n");
  
  // ステップ1: Fitbitからデータ取得（キャッシュ優先）
  const data = await getFitbitData("2025-01-01", "2025-01-31");
  
  // ステップ2: Supabaseに保存（モック）
  console.log("\n📤 Syncing to Supabase...");
  for (const chunk of data) {
    console.log(`   Syncing chunk: ${chunk.dateRange.start} to ${chunk.dateRange.end}`);
    
    // 実際の実装では以下のような処理を行う
    // await supabase.from('fitbit_sleep').upsert(chunk.sleep);
    // await supabase.from('fitbit_heart_rate').upsert(chunk.heartRate);
    // await supabase.from('fitbit_activity').upsert(chunk.activity);
    // ... etc
  }
  
  console.log("✅ Sync complete!");
}

// ========================================
// 実行
// ========================================
if (import.meta.main) {
  try {
    // 実行したい例を選択
    await example1_cacheFirst();
    // await example2_forceRefresh();
    // await example3_supabaseSync();
  } catch (error) {
    console.error("❌ Error:", error.message);
    Deno.exit(1);
  }
}
