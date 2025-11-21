// cache.ts - Fitbitデータのキャッシュ操作

import { ensureDir } from "https://deno.land/std@0.203.0/fs/mod.ts";
import { DateRange, FitbitAllScopeData, CachedAllScopeData } from "./types.ts";

const CACHE_DIR = "./cache";

/**
 * キャッシュファイルのパスを生成
 */
export function getCacheFilePath(range: DateRange): string {
  return `${CACHE_DIR}/fitbit_${range.start}_${range.end}.json`;
}

/**
 * キャッシュファイルが存在するかチェック
 */
export async function checkCacheExists(range: DateRange): Promise<boolean> {
  const filePath = getCacheFilePath(range);
  try {
    await Deno.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * キャッシュからデータを読み込む
 * @returns キャッシュが存在する場合はデータ、存在しない場合はnull
 */
export async function loadCachedData(
  range: DateRange
): Promise<FitbitAllScopeData | null> {
  const filePath = getCacheFilePath(range);

  try {
    const content = await Deno.readTextFile(filePath);
    const cached: CachedAllScopeData = JSON.parse(content);
    console.log(`   📂 Cache hit: ${filePath}`);
    console.log(`      Cached at: ${cached.fetchedAt}`);
    return cached.data;
  } catch {
    console.log(`   🔍 Cache miss: ${filePath}`);
    return null;
  }
}

/**
 * データをキャッシュに保存
 */
export async function saveCachedData(
  range: DateRange,
  data: FitbitAllScopeData
): Promise<void> {
  const filePath = getCacheFilePath(range);

  const cached: CachedAllScopeData = {
    dateRange: range,
    fetchedAt: new Date().toISOString(),
    data,
  };

  await ensureDir(CACHE_DIR);
  await Deno.writeTextFile(filePath, JSON.stringify(cached, null, 2));
  console.log(`   💾 Cached to: ${filePath}`);
}

/**
 * 複数の日付範囲に対してキャッシュが全て存在するかチェック
 */
export async function checkAllCachesExist(
  ranges: DateRange[]
): Promise<boolean> {
  for (const range of ranges) {
    const exists = await checkCacheExists(range);
    if (!exists) {
      return false;
    }
  }
  return true;
}
