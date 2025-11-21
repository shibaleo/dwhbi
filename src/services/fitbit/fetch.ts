/**
 * fitbit/fetch.ts
 * Fitbit APIからデータを取得する内部関数（外部から直接呼ばない）
 */

import { FitbitAllScopeData, DateRange } from "./types.ts";

// =========================================
// 定数
// =========================================

const FITBIT_API_BASE = "https://api.fitbit.com";
const MAX_DAYS_PER_CHUNK = 90; // Fitbit APIの制限
const RETRY_MAX = 3;
const RETRY_DELAY_MS = 2000;

// =========================================
// トークン取得
// =========================================

interface FitbitTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user_fitbit_id?: string;
}

/**
 * Supabaseからトークンを取得してリフレッシュ
 */
async function getValidFitbitToken(): Promise<string> {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // トークン取得
  const { data: tokenData, error: fetchError } = await supabase
    .from("fitbit_tokens")
    .select("*")
    .single();

  if (fetchError || !tokenData) {
    throw new Error("Fitbitトークンが見つかりません");
  }

  const token = tokenData as unknown as FitbitTokenData;
  const expiresAt = new Date(token.expires_at);
  const now = new Date();

  // トークンが有効ならそのまま返す
  if (expiresAt > now) {
    return token.access_token;
  }

  // リフレッシュが必要
  console.log("🔄 トークンをリフレッシュしています...");

  const clientId = Deno.env.get("FITBIT_CLIENT_ID");
  const clientSecret = Deno.env.get("FITBIT_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET are required");
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const refreshResponse = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });

  if (!refreshResponse.ok) {
    throw new Error(`トークンリフレッシュ失敗: ${refreshResponse.status}`);
  }

  const refreshData = await refreshResponse.json();

  // 新しいトークンを保存
  const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000);

  await supabase
    .from("fitbit_tokens")
    .update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: newExpiresAt.toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", (tokenData as any).id);

  console.log("✅ トークンリフレッシュ完了");
  return refreshData.access_token;
}

// =========================================
// API呼び出し（レート制限対応）
// =========================================

/**
 * リトライ付きfetch
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = RETRY_MAX
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      // レート制限エラー
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "60");
        console.warn(`⚠️  レート制限: ${retryAfter}秒待機...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      // その他のエラーでリトライ
      if (!response.ok && i < retries - 1) {
        console.warn(`⚠️  リトライ ${i + 1}/${retries}: ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`⚠️  リトライ ${i + 1}/${retries}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  throw new Error("最大リトライ回数を超えました");
}

/**
 * 単一エンドポイントを取得
 */
async function fetchEndpoint(
  endpoint: string,
  token: string,
  extractor: (json: any) => any,
  label: string
): Promise<any> {
  const url = `${FITBIT_API_BASE}${endpoint}`;
  
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.error(`❌ ${label}: ${response.status}`);
      return [];
    }

    const json = await response.json();
    return extractor(json);
  } catch (error) {
    console.error(`❌ ${label}: ${(error as Error).message}`);
    return [];
  }
}

// =========================================
// グループ化されたリクエスト
// =========================================

/**
 * 5グループに分けて並行リクエスト（レート制限対策）
 */
async function fetchAllEndpointsForDateRange(
  start: string,
  end: string,
  token: string
): Promise<FitbitAllScopeData> {
  console.log(`  📡 API取得: ${start} 〜 ${end}`);

  // グループ1: Sleep, Heart Rate
  const [sleep, heartRate] = await Promise.all([
    fetchEndpoint(
      `/1.2/user/-/sleep/date/${start}/${end}.json`,
      token,
      (r) => r.sleep || [],
      "Sleep"
    ),
    fetchEndpoint(
      `/1/user/-/activities/heart/date/${start}/${end}.json`,
      token,
      (r) => r["activities-heart"] || [],
      "Heart Rate"
    ),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // グループ2: Activity基本
  const [activitySteps, activityDistance, activityCalories, activityFloors] =
    await Promise.all([
      fetchEndpoint(
        `/1/user/-/activities/steps/date/${start}/${end}.json`,
        token,
        (r) => r["activities-steps"] || [],
        "Steps"
      ),
      fetchEndpoint(
        `/1/user/-/activities/distance/date/${start}/${end}.json`,
        token,
        (r) => r["activities-distance"] || [],
        "Distance"
      ),
      fetchEndpoint(
        `/1/user/-/activities/calories/date/${start}/${end}.json`,
        token,
        (r) => r["activities-calories"] || [],
        "Calories"
      ),
      fetchEndpoint(
        `/1/user/-/activities/floors/date/${start}/${end}.json`,
        token,
        (r) => r["activities-floors"] || [],
        "Floors"
      ),
    ]);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // グループ3: Activity詳細
  const [
    activityElevation,
    activityMinutesSedentary,
    activityMinutesLightlyActive,
    activityMinutesFairlyActive,
  ] = await Promise.all([
    fetchEndpoint(
      `/1/user/-/activities/elevation/date/${start}/${end}.json`,
      token,
      (r) => r["activities-elevation"] || [],
      "Elevation"
    ),
    fetchEndpoint(
      `/1/user/-/activities/minutesSedentary/date/${start}/${end}.json`,
      token,
      (r) => r["activities-minutesSedentary"] || [],
      "Minutes Sedentary"
    ),
    fetchEndpoint(
      `/1/user/-/activities/minutesLightlyActive/date/${start}/${end}.json`,
      token,
      (r) => r["activities-minutesLightlyActive"] || [],
      "Minutes Lightly Active"
    ),
    fetchEndpoint(
      `/1/user/-/activities/minutesFairlyActive/date/${start}/${end}.json`,
      token,
      (r) => r["activities-minutesFairlyActive"] || [],
      "Minutes Fairly Active"
    ),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // グループ4: Activity残り & Body
  const [activityMinutesVeryActive, bodyWeight, bodyFat] = await Promise.all([
    fetchEndpoint(
      `/1/user/-/activities/minutesVeryActive/date/${start}/${end}.json`,
      token,
      (r) => r["activities-minutesVeryActive"] || [],
      "Minutes Very Active"
    ),
    fetchEndpoint(
      `/1/user/-/body/weight/date/${start}/${end}.json`,
      token,
      (r) => r["body-weight"] || [],
      "Body Weight"
    ),
    fetchEndpoint(
      `/1/user/-/body/fat/date/${start}/${end}.json`,
      token,
      (r) => r["body-fat"] || [],
      "Body Fat"
    ),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  // グループ5: SpO2
  const [spO2] = await Promise.all([
    fetchEndpoint(
      `/1/user/-/spo2/date/${start}/${end}.json`,
      token,
      (r) => r || [],
      "SpO2"
    ),
  ]);

  return {
    sleep,
    heartRate,
    activitySteps,
    activityDistance,
    activityCalories,
    activityFloors,
    activityElevation,
    activityMinutesSedentary,
    activityMinutesLightlyActive,
    activityMinutesFairlyActive,
    activityMinutesVeryActive,
    bodyWeight,
    bodyFat,
    spO2,
  };
}

// =========================================
// 日付チャンク分割
// =========================================

/**
 * 日付範囲を90日チャンクに分割
 */
function splitIntoChunks(startDate: string, endDate: string): DateRange[] {
  const chunks: DateRange[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let currentStart = new Date(start);

  while (currentStart <= end) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + MAX_DAYS_PER_CHUNK - 1);

    if (currentEnd > end) {
      currentEnd.setTime(end.getTime());
    }

    chunks.push({
      start: currentStart.toISOString().split("T")[0],
      end: currentEnd.toISOString().split("T")[0],
    });

    currentStart.setDate(currentEnd.getDate() + 1);
  }

  return chunks;
}

/**
 * チャンクデータを日付ごとに分解
 */
function splitChunkByDate(
  chunkData: FitbitAllScopeData,
  start: string,
  end: string
): Map<string, FitbitAllScopeData> {
  const result = new Map<string, FitbitAllScopeData>();
  const startDate = new Date(start);
  const endDate = new Date(end);

  // 日付ごとの空データを初期化
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    result.set(dateStr, {
      date: dateStr,
      sleep: [],
      heartRate: [],
      activitySteps: [],
      activityDistance: [],
      activityCalories: [],
      activityFloors: [],
      activityElevation: [],
      activityMinutesSedentary: [],
      activityMinutesLightlyActive: [],
      activityMinutesFairlyActive: [],
      activityMinutesVeryActive: [],
      bodyWeight: [],
      bodyFat: [],
      spO2: [],
    });
  }

  // 各データを日付で振り分け
  const distributeByDate = (items: any[], key: keyof FitbitAllScopeData) => {
    for (const item of items) {
      const itemDate = item.dateTime || item.dateOfSleep || item.date;
      if (itemDate && result.has(itemDate)) {
        result.get(itemDate)![key]!.push(item);
      }
    }
  };

  distributeByDate(chunkData.sleep || [], "sleep");
  distributeByDate(chunkData.heartRate || [], "heartRate");
  distributeByDate(chunkData.activitySteps || [], "activitySteps");
  distributeByDate(chunkData.activityDistance || [], "activityDistance");
  distributeByDate(chunkData.activityCalories || [], "activityCalories");
  distributeByDate(chunkData.activityFloors || [], "activityFloors");
  distributeByDate(chunkData.activityElevation || [], "activityElevation");
  distributeByDate(chunkData.activityMinutesSedentary || [], "activityMinutesSedentary");
  distributeByDate(chunkData.activityMinutesLightlyActive || [], "activityMinutesLightlyActive");
  distributeByDate(chunkData.activityMinutesFairlyActive || [], "activityMinutesFairlyActive");
  distributeByDate(chunkData.activityMinutesVeryActive || [], "activityMinutesVeryActive");
  distributeByDate(chunkData.bodyWeight || [], "bodyWeight");
  distributeByDate(chunkData.bodyFat || [], "bodyFat");
  distributeByDate(chunkData.spO2 || [], "spO2");

  return result;
}

// =========================================
// メイン取得関数（内部用）
// =========================================

/**
 * Fitbit APIからデータを取得（内部用・トークン取得あり）
 * 外部からは呼ばず、api.tsから呼び出される
 */
export async function fetchFitbitData(
  startDate: string,
  endDate: string
): Promise<Map<string, FitbitAllScopeData>> {
  console.log(`\n🔐 トークンを取得しています...`);
  const token = await getValidFitbitToken();

  console.log(`📅 取得期間: ${startDate} 〜 ${endDate}`);
  const chunks = splitIntoChunks(startDate, endDate);
  console.log(`📦 ${chunks.length}チャンクに分割`);

  const allData = new Map<string, FitbitAllScopeData>();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`\n[${i + 1}/${chunks.length}] ${chunk.start} 〜 ${chunk.end}`);

    const chunkData = await fetchAllEndpointsForDateRange(
      chunk.start,
      chunk.end,
      token
    );

    const dailyData = splitChunkByDate(chunkData, chunk.start, chunk.end);

    // マージ
    for (const [date, data] of dailyData) {
      allData.set(date, data);
    }

    // チャンク間の待機
    if (i < chunks.length - 1) {
      console.log("  ⏸️  次のチャンクまで3秒待機...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  console.log(`\n✅ ${allData.size}日分のデータを取得しました`);
  return allData;
}