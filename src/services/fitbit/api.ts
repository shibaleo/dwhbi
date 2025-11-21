/**
 * fitbit/api.ts
 * 外部向けインターフェース - キャッシュを自動管理してFitbitデータを取得
 */

import { FitbitAllScopeData, CachedAllScopeData, DateRange } from "./types.ts";
import {
  loadCachedData,
  saveCachedData,
  checkAllCachesExist,
} from "./cache.ts";
import { fetchFitbitData } from "./fetch.ts";

// =========================================
// 外部向けメイン関数
// =========================================

/**
 * Fitbitデータを取得（キャッシュ優先）
 * 
 * @param startDate - 開始日 (YYYY-MM-DD)
 * @param endDate - 終了日 (YYYY-MM-DD)
 * @param options - オプション
 * @returns 日付ごとのFitbitデータの配列
 * 
 * @example
 * ```typescript
 * // キャッシュがあればキャッシュから、なければAPIから取得
 * const data = await getFitbitData("2025-01-01", "2025-01-31");
 * 
 * // 強制的にAPIから取得（キャッシュを無視）
 * const data = await getFitbitData("2025-01-01", "2025-01-31", { forceRefresh: true });
 * ```
 */
export async function getFitbitData(
  startDate: string,
  endDate: string,
  options: { forceRefresh?: boolean } = {}
): Promise<CachedAllScopeData[]> {
  const { forceRefresh = false } = options;

  // 90日チャンクに分割
  const chunks = splitInto90DayChunks(startDate, endDate);

  // 強制リフレッシュモード
  if (forceRefresh) {
    console.log("🔄 強制リフレッシュモード: APIから取得します");
    return await fetchAndCacheData(startDate, endDate);
  }

  // キャッシュチェック
  console.log(`📂 キャッシュをチェックしています: ${startDate} 〜 ${endDate}`);
  const allCached = await checkAllCachesExist(chunks);

  if (allCached) {
    // すべてキャッシュから取得
    console.log(`✅ すべてキャッシュから取得します`);
    return await loadAllCachedData(chunks);
  }

  console.log(`⚠️  一部またはすべてのキャッシュなし: APIから取得します`);

  // APIから取得してキャッシュに保存
  return await fetchAndCacheData(startDate, endDate);
}

// =========================================
// 内部ヘルパー関数
// =========================================

/**
 * 日付範囲を90日チャンクに分割
 */
function splitInto90DayChunks(startDate: string, endDate: string): DateRange[] {
  const MAX_DAYS = 90;
  const chunks: DateRange[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let currentStart = new Date(start);

  while (currentStart <= end) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + MAX_DAYS - 1);

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
 * 複数のチャンクのキャッシュを読み込み
 */
async function loadAllCachedData(chunks: DateRange[]): Promise<CachedAllScopeData[]> {
  const results: CachedAllScopeData[] = [];

  for (const chunk of chunks) {
    try {
      const cached = await loadCachedData(chunk);
      if (cached) {
        // チャンクデータを日付ごとに分解
        const dailyData = splitChunkByDate(cached, chunk.start, chunk.end);
        results.push(...dailyData);
      }
    } catch (err) {
      console.warn(`⚠️  ${chunk.start}〜${chunk.end}: キャッシュ読み込み失敗`);
    }
  }

  return results;
}

/**
 * チャンクデータを日付ごとに分解
 */
function splitChunkByDate(
  chunkData: FitbitAllScopeData,
  start: string,
  end: string
): CachedAllScopeData[] {
  const results: CachedAllScopeData[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);

  // 日付ごとのデータマップを作成
  const dailyMap = new Map<string, FitbitAllScopeData>();

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    dailyMap.set(dateStr, {
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
    if (!items) return;
    for (const item of items) {
      const itemDate = item.dateTime || item.dateOfSleep || item.date;
      if (itemDate && dailyMap.has(itemDate)) {
        dailyMap.get(itemDate)![key]!.push(item);
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

  // 結果を配列に変換
  for (const [date, data] of dailyMap) {
    results.push({
      date,
      data,
      cachedAt: new Date().toISOString(),
    });
  }

  return results;
}

/**
 * APIから取得してキャッシュに保存
 */
async function fetchAndCacheData(
  startDate: string,
  endDate: string
): Promise<CachedAllScopeData[]> {
  // fetchFitbitData() は Map<date, FitbitAllScopeData> を返す
  const dataMap = await fetchFitbitData(startDate, endDate);

  console.log(`\n💾 キャッシュに保存しています...`);

  const results: CachedAllScopeData[] = [];

  // 日付ごとのデータを配列に変換
  for (const [date, data] of dataMap) {
    results.push({
      date,
      data,
      cachedAt: new Date().toISOString(),
    });
  }

  // 90日チャンクごとにキャッシュ保存
  const chunks = splitInto90DayChunks(startDate, endDate);
  
  for (const chunk of chunks) {
    // このチャンクに含まれるデータを集約
    const chunkData: FitbitAllScopeData = {
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
    };

    for (const { data } of results) {
      if (data.date && data.date >= chunk.start && data.date <= chunk.end) {
        chunkData.sleep.push(...(data.sleep || []));
        chunkData.heartRate.push(...(data.heartRate || []));
        chunkData.activitySteps.push(...(data.activitySteps || []));
        chunkData.activityDistance.push(...(data.activityDistance || []));
        chunkData.activityCalories.push(...(data.activityCalories || []));
        chunkData.activityFloors.push(...(data.activityFloors || []));
        chunkData.activityElevation.push(...(data.activityElevation || []));
        chunkData.activityMinutesSedentary.push(...(data.activityMinutesSedentary || []));
        chunkData.activityMinutesLightlyActive.push(...(data.activityMinutesLightlyActive || []));
        chunkData.activityMinutesFairlyActive.push(...(data.activityMinutesFairlyActive || []));
        chunkData.activityMinutesVeryActive.push(...(data.activityMinutesVeryActive || []));
        chunkData.bodyWeight.push(...(data.bodyWeight || []));
        chunkData.bodyFat.push(...(data.bodyFat || []));
        chunkData.spO2.push(...(data.spO2 || []));
      }
    }

    try {
      await saveCachedData(chunk, chunkData);
      console.log(`✅ ${chunk.start}〜${chunk.end}: キャッシュ保存完了`);
    } catch (err) {
      console.error(`❌ ${chunk.start}〜${chunk.end}: キャッシュ保存失敗`, err.message);
    }
  }

  return results;
}