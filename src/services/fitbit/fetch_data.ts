// fetch_data.ts
// Fitbit API からのデータ取得オーケストレーション
// 長期間同期対応（全APIにチャンク処理適用、レート制限管理）

import { FitbitAPI, formatFitbitDate } from "./api.ts";
import type {
  ActivitySummary,
  AzmDay,
  BreathingRateDay,
  CardioScoreDay,
  FetchOptions,
  FitbitData,
  HeartRateDay,
  HeartRateIntraday,
  HrvDay,
  SleepLog,
  Spo2ApiResponse,
  TemperatureSkinDay,
} from "./types.ts";

// ========== 定数 ==========

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

// ========== レート制限管理 ==========

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
        console.log(`\n⏳ レート制限に近づきました（${this.requestCount}/${RATE_LIMIT}）`);
        console.log(`   ${waitMinutes}分間待機します...\n`);
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

// ========== ヘルパー ==========

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

// ========== 個別取得関数（全てチャンク対応・レート制限対応） ==========

interface FetchContext {
  api: FitbitAPI;
  startDate: Date;
  endDate: Date;
  dates: Date[];
  includeIntraday: boolean;
}

async function fetchSleep(ctx: FetchContext): Promise<SleepLog[]> {
  console.log("😴 睡眠データ取得中...");
  const results: SleepLog[] = [];

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
    console.log(`   取得: ${results.length}件 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchHeartRate(ctx: FetchContext): Promise<HeartRateDay[]> {
  console.log("❤️  心拍数データ取得中...");
  const results: HeartRateDay[] = [];

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
    console.log(`   取得: ${results.length}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchHrv(ctx: FetchContext): Promise<HrvDay[]> {
  console.log("📈 HRVデータ取得中...");
  const results: HrvDay[] = [];

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
    console.log(`   取得: ${results.length}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchBreathingRate(ctx: FetchContext): Promise<BreathingRateDay[]> {
  console.log("🌬️  呼吸数データ取得中...");
  const results: BreathingRateDay[] = [];

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
    console.log(`   取得: ${results.length}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchCardioScore(ctx: FetchContext): Promise<CardioScoreDay[]> {
  console.log("🏃 VO2 Maxデータ取得中...");
  const results: CardioScoreDay[] = [];

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
    console.log(`   取得: ${results.length}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchTemperatureSkin(ctx: FetchContext): Promise<TemperatureSkinDay[]> {
  console.log("🌡️  皮膚温度データ取得中...");
  const results: TemperatureSkinDay[] = [];

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
    console.log(`   取得: ${results.length}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchAzm(ctx: FetchContext): Promise<AzmDay[]> {
  console.log("⚡ AZMデータ取得中...");
  const results: AzmDay[] = [];

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
    console.log(`   取得: ${results.length}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  } catch (error) {
    console.error(`   ❌ エラー: ${error instanceof Error ? error.message : error}`);
  }

  return results;
}

async function fetchSpo2(ctx: FetchContext): Promise<Map<string, Spo2ApiResponse>> {
  console.log("🫁 SpO2データ取得中...");
  const results = new Map<string, Spo2ApiResponse>();

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

  console.log(`   取得: ${results.size}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  return results;
}

async function fetchActivity(ctx: FetchContext): Promise<Map<string, ActivitySummary>> {
  console.log("🚶 活動データ取得中...");
  const results = new Map<string, ActivitySummary>();

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

  console.log(`   取得: ${results.size}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  return results;
}

async function fetchHeartRateIntraday(
  ctx: FetchContext,
): Promise<Map<string, HeartRateIntraday>> {
  console.log("❤️  心拍数Intradayデータ取得中...");
  const results = new Map<string, HeartRateIntraday>();

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

  console.log(`   取得: ${results.size}日分 (リクエスト残: ${rateLimiter.getRemainingInWindow()})`);
  return results;
}

// ========== メイン関数 ==========

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

  console.log(
    `📅 取得期間: ${formatFitbitDate(startDate)} 〜 ${formatFitbitDate(endDate)}`,
  );
  console.log(`   対象日数: ${dates.length}日間`);
  console.log(`   推定リクエスト数: ${estimatedRequests}件`);
  console.log(`   Intraday: ${includeIntraday ? "あり" : "なし"}`);
  console.log(`   モード: ${isLongRange ? "長期間（順次処理）" : "短期間（並列処理）"}\n`);

  let sleepData: SleepLog[];
  let heartRateData: HeartRateDay[];
  let hrvData: HrvDay[];
  let breathingRateData: BreathingRateDay[];
  let cardioScoreData: CardioScoreDay[];
  let temperatureSkinData: TemperatureSkinDay[];
  let azmData: AzmDay[];
  let spo2Data: Map<string, Spo2ApiResponse>;
  let activityData: Map<string, ActivitySummary>;
  let heartRateIntradayData: Map<string, HeartRateIntraday>;

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

  console.log("\n📊 取得完了");
  console.log(`   睡眠: ${result.sleep.length}件`);
  console.log(`   心拍: ${result.heartRate.length}日分`);
  console.log(`   HRV: ${result.hrv.length}日分`);
  console.log(`   SpO2: ${result.spo2.size}日分`);
  console.log(`   呼吸数: ${result.breathingRate.length}日分`);
  console.log(`   VO2 Max: ${result.cardioScore.length}日分`);
  console.log(`   皮膚温度: ${result.temperatureSkin.length}日分`);
  console.log(`   活動: ${result.activity.size}日分`);
  console.log(`   総リクエスト数: ${rateLimiter.getCount()}件`);

  return result;
}
