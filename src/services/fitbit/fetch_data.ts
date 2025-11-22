/**
 * Fitbit API データ取得オーケストレーション
 *
 * 長期間同期対応（全APIにチャンク処理適用、レート制限管理）
 */
import { FitbitAPI, formatFitbitDate } from "./api.ts";
import * as log from "../../utils/log.ts";
import type {
  FitbitApiActivitySummary,
  FitbitApiAzmDay,
  FitbitApiBreathingRateDay,
  FitbitApiCardioScoreDay,
  FitbitApiHeartRateDay,
  FitbitApiHeartRateIntraday,
  FitbitApiHrvDay,
  FitbitApiSleepLog,
  FitbitApiSpo2Response,
  FitbitApiTemperatureSkinDay,
  FetchOptions,
  FitbitData,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

// Fitbit API レート制限: 150リクエスト/時間
const RATE_LIMIT = 150;
const RATE_LIMIT_THRESHOLD = 140; // この数を超えたら待機
const RATE_LIMIT_WAIT_MS = 60 * 60 * 1000; // 1時間待機

const API_DELAY_MS = 100; // API呼び出し間の最小待機時間
const CHUNK_DELAY_MS = 300; // チャンク間の待機時間
const MAX_CONCURRENT = 3; // 同時実行数の上限

// 各APIの最大日数制限
const SLEEP_MAX_DAYS = 100;
const HEART_RATE_MAX_DAYS = 30;
const HRV_MAX_DAYS = 30;
const BREATHING_RATE_MAX_DAYS = 30;
const CARDIO_SCORE_MAX_DAYS = 30;
const TEMP_MAX_DAYS = 30;
const AZM_MAX_DAYS = 30;

// =============================================================================
// Rate Limiter
// =============================================================================

class RateLimiter {
  private requestCount = 0;
  private windowStart = Date.now();

  async trackRequest(): Promise<void> {
    const now = Date.now();
    
    // 1時間経過したらリセット
    if (now - this.windowStart >= RATE_LIMIT_WAIT_MS) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    this.requestCount++;

    // 閾値を超えたら待機
    if (this.requestCount >= RATE_LIMIT_THRESHOLD) {
      const waitTime = RATE_LIMIT_WAIT_MS - (now - this.windowStart);
      if (waitTime > 0) {
        const waitMinutes = Math.ceil(waitTime / 60000);
        log.warn(`Rate limit approaching (${this.requestCount}/${RATE_LIMIT})`);
        log.info(`Waiting ${waitMinutes} minutes...`);
        await sleep(waitTime);
        this.requestCount = 0;
        this.windowStart = Date.now();
      }
    }
  }

  getCount(): number {
    return this.requestCount;
  }

  getRemainingInWindow(): number {
    return RATE_LIMIT_THRESHOLD - this.requestCount;
  }
}

// グローバルレートリミッター
const rateLimiter = new RateLimiter();

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 同時実行数を制限しながらPromiseを実行（レート制限対応）
 */
async function parallelWithLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
  delayMs: number = 0,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    await rateLimiter.trackRequest();
    
    const p = (async () => {
      const result = await fn(item);
      results.push(result);
      if (delayMs > 0) await sleep(delayMs);
    })();

    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      const completed = executing.findIndex(
        (e) => e.then(() => true).catch(() => true),
      );
      if (completed !== -1) {
        await executing[completed];
        executing.splice(completed, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * 日付リストを生成（startからendまで）
 * UTC基準で処理し、実行環境のタイムゾーンに依存しない
 */
export function generateDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);
  current.setUTCHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * 期間をチャンクに分割
 */
export function generatePeriods(
  startDate: Date,
  endDate: Date,
  maxDays: number,
): Array<{ from: Date; to: Date }> {
  const periods: Array<{ from: Date; to: Date }> = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const periodEnd = new Date(current);
    periodEnd.setDate(periodEnd.getDate() + maxDays - 1);

    if (periodEnd > endDate) {
      periodEnd.setTime(endDate.getTime());
    }

    periods.push({
      from: new Date(current),
      to: new Date(periodEnd),
    });

    current = new Date(periodEnd);
    current.setDate(current.getDate() + 1);
  }

  return periods;
}

// =============================================================================
// Individual Fetch Functions
// =============================================================================

interface FetchContext {
  api: FitbitAPI;
  startDate: Date;
  endDate: Date;
  dates: Date[];
  includeIntraday: boolean;
}

async function fetchSleep(ctx: FetchContext): Promise<FitbitApiSleepLog[]> {
  log.info("Fetching sleep data...");
  const results: FitbitApiSleepLog[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, SLEEP_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getSleepByDateRange(period.from, period.to);
        results.push(...(res.sleep || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視して続行
      }
    }
    log.info(`Sleep: ${results.length} records (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`Sleep error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchHeartRate(ctx: FetchContext): Promise<FitbitApiHeartRateDay[]> {
  log.info("Fetching heart rate data...");
  const results: FitbitApiHeartRateDay[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, HEART_RATE_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getHeartRateByDateRange(period.from, period.to);
        results.push(...(res["activities-heart"] || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視して続行
      }
    }
    log.info(`Heart rate: ${results.length} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`Heart rate error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchHrv(ctx: FetchContext): Promise<FitbitApiHrvDay[]> {
  log.info("Fetching HRV data...");
  const results: FitbitApiHrvDay[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, HRV_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getHrvByDateRange(period.from, period.to);
        results.push(...(res.hrv || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視（HRVは2020年以降のみ）
      }
    }
    log.info(`HRV: ${results.length} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`HRV error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchBreathingRate(ctx: FetchContext): Promise<FitbitApiBreathingRateDay[]> {
  log.info("Fetching breathing rate data...");
  const results: FitbitApiBreathingRateDay[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, BREATHING_RATE_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getBreathingRateByDateRange(period.from, period.to);
        results.push(...(res.br || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視（呼吸数は2020年以降のみ）
      }
    }
    log.info(`Breathing rate: ${results.length} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`Breathing rate error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchCardioScore(ctx: FetchContext): Promise<FitbitApiCardioScoreDay[]> {
  log.info("Fetching VO2 Max data...");
  const results: FitbitApiCardioScoreDay[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, CARDIO_SCORE_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getCardioScoreByDateRange(period.from, period.to);
        results.push(...(res.cardioScore || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視（VO2 Maxは2020年以降のみ）
      }
    }
    log.info(`VO2 Max: ${results.length} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`VO2 Max error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchTemperatureSkin(ctx: FetchContext): Promise<FitbitApiTemperatureSkinDay[]> {
  log.info("Fetching skin temperature data...");
  const results: FitbitApiTemperatureSkinDay[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, TEMP_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getTemperatureSkinByDateRange(period.from, period.to);
        results.push(...(res.tempSkin || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視（皮膚温度は2020年以降のみ）
      }
    }
    log.info(`Skin temperature: ${results.length} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`Skin temperature error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchAzm(ctx: FetchContext): Promise<FitbitApiAzmDay[]> {
  log.info("Fetching AZM data...");
  const results: FitbitApiAzmDay[] = [];

  try {
    const periods = generatePeriods(ctx.startDate, ctx.endDate, AZM_MAX_DAYS);
    for (const period of periods) {
      try {
        await rateLimiter.trackRequest();
        const res = await ctx.api.getAzmByDateRange(period.from, period.to);
        results.push(...(res["activities-active-zone-minutes"] || []));
        await sleep(CHUNK_DELAY_MS);
      } catch {
        // チャンクエラーは無視（AZMは2020年以降のみ）
      }
    }
    log.info(`AZM: ${results.length} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  } catch (err) {
    log.error(`AZM error: ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

async function fetchSpo2(ctx: FetchContext): Promise<Map<string, FitbitApiSpo2Response>> {
  log.info("Fetching SpO2 data...");
  const results = new Map<string, FitbitApiSpo2Response>();

  await parallelWithLimit(
    ctx.dates,
    async (date) => {
      try {
        const res = await ctx.api.getSpo2ByDate(date);
        if (res.value) {
          results.set(formatFitbitDate(date), res);
        }
      } catch {
        // データがない日はスキップ
      }
    },
    MAX_CONCURRENT,
    API_DELAY_MS,
  );

  log.info(`SpO2: ${results.size} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  return results;
}

async function fetchActivity(ctx: FetchContext): Promise<Map<string, FitbitApiActivitySummary>> {
  log.info("Fetching activity data...");
  const results = new Map<string, FitbitApiActivitySummary>();

  await parallelWithLimit(
    ctx.dates,
    async (date) => {
      try {
        const res = await ctx.api.getActivityDailySummary(date);
        results.set(formatFitbitDate(date), res.summary);
      } catch {
        // エラーはスキップ
      }
    },
    MAX_CONCURRENT,
    API_DELAY_MS,
  );

  log.info(`Activity: ${results.size} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  return results;
}

async function fetchHeartRateIntraday(
  ctx: FetchContext,
): Promise<Map<string, FitbitApiHeartRateIntraday>> {
  log.info("Fetching heart rate intraday data...");
  const results = new Map<string, FitbitApiHeartRateIntraday>();

  await parallelWithLimit(
    ctx.dates,
    async (date) => {
      try {
        const res = await ctx.api.getHeartRateIntraday(date);
        const intraday = res["activities-heart-intraday"];
        if (intraday?.dataset && intraday.dataset.length > 0) {
          results.set(formatFitbitDate(date), intraday);
        }
      } catch {
        // Intradayエラーは無視
      }
    },
    MAX_CONCURRENT,
    API_DELAY_MS,
  );

  log.info(`Heart rate intraday: ${results.size} days (remaining: ${rateLimiter.getRemainingInWindow()})`);
  return results;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * 推定リクエスト数を計算
 */
function estimateRequestCount(days: number, includeIntraday: boolean): number {
  const sleepRequests = Math.ceil(days / SLEEP_MAX_DAYS);
  const heartRateRequests = Math.ceil(days / HEART_RATE_MAX_DAYS);
  const hrvRequests = Math.ceil(days / HRV_MAX_DAYS);
  const breathingRateRequests = Math.ceil(days / BREATHING_RATE_MAX_DAYS);
  const cardioScoreRequests = Math.ceil(days / CARDIO_SCORE_MAX_DAYS);
  const tempRequests = Math.ceil(days / TEMP_MAX_DAYS);
  const azmRequests = Math.ceil(days / AZM_MAX_DAYS);
  const spo2Requests = days; // 1日ずつ
  const activityRequests = days; // 1日ずつ
  const intradayRequests = includeIntraday ? days : 0;

  return (
    sleepRequests +
    heartRateRequests +
    hrvRequests +
    breathingRateRequests +
    cardioScoreRequests +
    tempRequests +
    azmRequests +
    spo2Requests +
    activityRequests +
    intradayRequests
  );
}

/**
 * 指定期間のFitbitデータを取得
 * 短期間（30日以内）: 並列処理で高速化
 * 長期間（30日超）: 順次処理でレート制限回避
 */
export async function fetchFitbitData(
  accessToken: string,
  options: FetchOptions = {},
): Promise<FitbitData> {
  const {
    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    includeIntraday = false,
  } = options;

  const api = new FitbitAPI(accessToken);
  const dates = generateDateRange(startDate, endDate);
  const isLongRange = dates.length > 30;
  const estimatedRequests = estimateRequestCount(dates.length, includeIntraday);

  const ctx: FetchContext = {
    api,
    startDate,
    endDate,
    dates,
    includeIntraday,
  };

  log.info(`Period: ${formatFitbitDate(startDate)} - ${formatFitbitDate(endDate)}`);
  log.info(`Days: ${dates.length}, Estimated requests: ${estimatedRequests}`);
  log.info(`Intraday: ${includeIntraday ? "yes" : "no"}, Mode: ${isLongRange ? "sequential" : "parallel"}`);

  let sleepData: FitbitApiSleepLog[];
  let heartRateData: FitbitApiHeartRateDay[];
  let hrvData: FitbitApiHrvDay[];
  let breathingRateData: FitbitApiBreathingRateDay[];
  let cardioScoreData: FitbitApiCardioScoreDay[];
  let temperatureSkinData: FitbitApiTemperatureSkinDay[];
  let azmData: FitbitApiAzmDay[];
  let spo2Data: Map<string, FitbitApiSpo2Response>;
  let activityData: Map<string, FitbitApiActivitySummary>;
  let heartRateIntradayData: Map<string, FitbitApiHeartRateIntraday>;

  if (isLongRange) {
    // 長期間: 順次処理でレート制限回避
    sleepData = await fetchSleep(ctx);
    heartRateData = await fetchHeartRate(ctx);
    hrvData = await fetchHrv(ctx);
    breathingRateData = await fetchBreathingRate(ctx);
    cardioScoreData = await fetchCardioScore(ctx);
    temperatureSkinData = await fetchTemperatureSkin(ctx);
    azmData = await fetchAzm(ctx);
    spo2Data = await fetchSpo2(ctx);
    activityData = await fetchActivity(ctx);
    heartRateIntradayData = includeIntraday
      ? await fetchHeartRateIntraday(ctx)
      : new Map();
  } else {
    // 短期間: 並列処理で高速化
    [
      sleepData,
      heartRateData,
      hrvData,
      breathingRateData,
      cardioScoreData,
      temperatureSkinData,
      azmData,
    ] = await Promise.all([
      fetchSleep(ctx),
      fetchHeartRate(ctx),
      fetchHrv(ctx),
      fetchBreathingRate(ctx),
      fetchCardioScore(ctx),
      fetchTemperatureSkin(ctx),
      fetchAzm(ctx),
    ]);

    [spo2Data, activityData, heartRateIntradayData] = await Promise.all([
      fetchSpo2(ctx),
      fetchActivity(ctx),
      includeIntraday ? fetchHeartRateIntraday(ctx) : Promise.resolve(new Map()),
    ]);
  }

  const result: FitbitData = {
    sleep: sleepData,
    activity: activityData,
    heartRate: heartRateData,
    heartRateIntraday: heartRateIntradayData,
    hrv: hrvData,
    spo2: spo2Data,
    breathingRate: breathingRateData,
    cardioScore: cardioScoreData,
    temperatureSkin: temperatureSkinData,
    azm: azmData,
  };

  log.section("Fetch Summary");
  log.info(`Sleep: ${result.sleep.length}`);
  log.info(`Heart rate: ${result.heartRate.length} days`);
  log.info(`HRV: ${result.hrv.length} days`);
  log.info(`SpO2: ${result.spo2.size} days`);
  log.info(`Breathing rate: ${result.breathingRate.length} days`);
  log.info(`VO2 Max: ${result.cardioScore.length} days`);
  log.info(`Skin temperature: ${result.temperatureSkin.length} days`);
  log.info(`Activity: ${result.activity.size} days`);
  log.info(`Total requests: ${rateLimiter.getCount()}`);

  return result;
}
