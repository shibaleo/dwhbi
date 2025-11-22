/**
 * Google Calendar API データ取得オーケストレーション
 *
 * 長期間同期対応（チャンク処理、レート制限管理）
 */

import { fetchEvents, getCalendarId, FetchEventsOptions } from "./api.ts";
import { transformEvents } from "./write_db.ts";
import * as log from "../../utils/log.ts";
import type {
  GCalApiEvent,
  DbEvent,
  SyncOptions,
} from "./types.ts";
import { GCalendarRateLimitError } from "./api.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルト開始日（Togglデータと合わせる） */
const DEFAULT_START_DATE = "2019-01-01T00:00:00+09:00";

/** チャンク処理の閾値（日数） */
const CHUNK_THRESHOLD_DAYS = 90;

/** チャンクサイズ（月数） */
const CHUNK_SIZE_MONTHS = 3;

/** チャンク間の待機時間（ms） */
const CHUNK_DELAY_MS = 300;

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 現在時刻をISO 8601形式で取得
 */
function getNow(): string {
  return new Date().toISOString();
}

/**
 * 同期オプションを正規化
 */
function normalizeOptions(options?: SyncOptions): Required<Omit<SyncOptions, "calendarId">> & { calendarId: string } {
  return {
    timeMin: options?.timeMin ?? DEFAULT_START_DATE,
    timeMax: options?.timeMax ?? getNow(),
    calendarId: options?.calendarId ?? getCalendarId(),
  };
}

/**
 * 期間の日数を計算
 */
function getDaysBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * 期間をチャンクに分割（月単位）
 */
function generateMonthlyPeriods(
  startDate: Date,
  endDate: Date,
  monthsPerChunk: number,
): Array<{ from: Date; to: Date }> {
  const periods: Array<{ from: Date; to: Date }> = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const periodEnd = new Date(current);
    periodEnd.setMonth(periodEnd.getMonth() + monthsPerChunk);

    if (periodEnd > endDate) {
      periodEnd.setTime(endDate.getTime());
    }

    periods.push({
      from: new Date(current),
      to: new Date(periodEnd),
    });

    current = new Date(periodEnd);
  }

  return periods;
}

// =============================================================================
// Fetch Functions
// =============================================================================

interface FetchContext {
  calendarId: string;
  retryOnRateLimit: boolean;
}

/**
 * 単一期間のイベントを取得（内部用）
 */
async function fetchEventsForPeriod(
  ctx: FetchContext,
  timeMin: string,
  timeMax: string,
): Promise<GCalApiEvent[]> {
  const fetchOptions: FetchEventsOptions = {
    calendarId: ctx.calendarId,
    timeMin,
    timeMax,
  };

  return await fetchEvents(fetchOptions);
}

/**
 * イベントを取得してDB形式に変換（チャンク処理対応）
 * 
 * @param options 同期オプション
 * @param retryOnRateLimit レート制限時にリトライするか（sync_all: true, sync_daily: false）
 */
export async function fetchAllEvents(
  options?: SyncOptions,
  retryOnRateLimit: boolean = true,
): Promise<{
  events: DbEvent[];
  raw: GCalApiEvent[];
}> {
  const normalizedOptions = normalizeOptions(options);
  const calendarId = normalizedOptions.calendarId;
  
  const startDate = new Date(normalizedOptions.timeMin);
  const endDate = new Date(normalizedOptions.timeMax);
  const totalDays = getDaysBetween(startDate, endDate);
  
  log.info(`Fetching events from ${normalizedOptions.timeMin} to ${normalizedOptions.timeMax}`);

  const ctx: FetchContext = {
    calendarId,
    retryOnRateLimit,
  };

  let allRawEvents: GCalApiEvent[] = [];

  // 短期間の場合は直接取得
  if (totalDays <= CHUNK_THRESHOLD_DAYS) {
    allRawEvents = await fetchEventsForPeriod(
      ctx,
      normalizedOptions.timeMin,
      normalizedOptions.timeMax,
    );
  } else {
    // 長期間の場合はチャンク処理
    const periods = generateMonthlyPeriods(startDate, endDate, CHUNK_SIZE_MONTHS);
    log.info(`Long range detected (${totalDays} days). Splitting into ${periods.length} chunks`);

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const periodStart = period.from.toISOString();
      const periodEnd = period.to.toISOString();

      log.info(`Chunk ${i + 1}/${periods.length}: ${periodStart.split("T")[0]} - ${periodEnd.split("T")[0]}`);

      try {
        const events = await fetchEventsForPeriod(ctx, periodStart, periodEnd);
        allRawEvents.push(...events);
        log.info(`  → ${events.length} events`);

        if (i < periods.length - 1) {
          await sleep(CHUNK_DELAY_MS);
        }
      } catch (err) {
        if (err instanceof GCalendarRateLimitError) {
          if (retryOnRateLimit) {
            log.warn(`Rate limit hit. Waiting ${err.retryAfterSeconds}s for reset...`);
            await sleep(err.retryAfterSeconds * 1000);
            i--; // 同じチャンクをリトライ
            continue;
          } else {
            log.warn(`Rate limit hit, skipping remaining chunks`);
            break;
          }
        }
        throw err;
      }
    }
  }

  const dbEvents = transformEvents(allRawEvents, calendarId);

  log.info(`Fetched: ${allRawEvents.length} events`);

  return {
    events: dbEvents,
    raw: allRawEvents,
  };
}

/**
 * 日数指定でイベントを取得（日次同期用）
 * 日付範囲: days日前から今日までを取得
 * レート制限時: スキップ（リトライしない）
 */
export async function fetchEventsByDays(
  days: number,
  options?: Omit<SyncOptions, "timeMin" | "timeMax">,
): Promise<{
  events: DbEvent[];
  raw: GCalApiEvent[];
}> {
  // endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  // startDate = endDate - (days + 1)
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  return fetchAllEvents(
    {
      ...options,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
    },
    false, // sync_daily: レート制限時はスキップ
  );
}
