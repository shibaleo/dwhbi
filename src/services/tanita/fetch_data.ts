/**
 * Tanita Health Planet API データ取得オーケストレーション
 */
import { TanitaAPI } from "./api.ts";
import * as log from "../../utils/log.ts";
import type { FetchOptions, TanitaData } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

// Tanita API は最大3ヶ月間のデータしか取得できない
const MAX_DAYS = 90;
const API_DELAY_MS = 200; // API呼び出し間の待機時間（レート制限: 60回/時間）

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 期間を3ヶ月ごとのチャンクに分割
 */
export function generatePeriods(
  startDate: Date,
  endDate: Date,
): Array<{ from: Date; to: Date }> {
  const periods: Array<{ from: Date; to: Date }> = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const periodEnd = new Date(current);
    periodEnd.setDate(periodEnd.getDate() + MAX_DAYS - 1);

    // 最後の期間は endDate まで
    if (periodEnd > endDate) {
      periodEnd.setTime(endDate.getTime());
    }

    periods.push({
      from: new Date(current),
      to: new Date(periodEnd),
    });

    // 次の期間の開始日
    current = new Date(periodEnd);
    current.setDate(current.getDate() + 1);
  }

  return periods;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * 日数指定でTanitaデータを取得（日次同期用）
 * 日付範囲: days日前から今日まで
 */
export async function fetchTanitaDataByDays(
  accessToken: string,
  days: number,
): Promise<TanitaData> {
  // endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 1);

  // startDate = endDate - (days + 1)
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days - 1);

  return fetchTanitaData(accessToken, { startDate, endDate });
}

/**
 * 指定期間のTanitaデータを取得（全件同期用）
 * 3ヶ月を超える期間は自動的にチャンク分割
 */
export async function fetchTanitaData(
  accessToken: string,
  options: FetchOptions = {},
): Promise<TanitaData> {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // デフォルト: 30日前
    endDate = new Date(),
  } = options;

  const api = new TanitaAPI(accessToken);
  const periods = generatePeriods(startDate, endDate);

  const result: TanitaData = {
    bodyComposition: [],
    bloodPressure: [],
    steps: [],
  };

  log.info(`Period: ${startDate.toISOString().split("T")[0]} - ${endDate.toISOString().split("T")[0]}`);
  log.info(`Chunks: ${periods.length} (max 90 days each)`);

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const periodStr = `${period.from.toISOString().split("T")[0]} - ${period.to.toISOString().split("T")[0]}`;

    if (periods.length > 1) {
      log.section(`Chunk ${i + 1}/${periods.length}: ${periodStr}`);
    }

    // 体組成データ
    log.info("Fetching body composition...");
    try {
      const bodyRes = await api.getBodyComposition(period.from, period.to);
      const bodyData = bodyRes.data || [];
      result.bodyComposition.push(...bodyData);
      log.info(`Body composition: ${bodyData.length}`);
    } catch (err) {
      log.error(`Body composition error: ${err instanceof Error ? err.message : err}`);
    }

    await sleep(API_DELAY_MS);

    // 血圧データ
    log.info("Fetching blood pressure...");
    try {
      const bpRes = await api.getBloodPressure(period.from, period.to);
      const bpData = bpRes.data || [];
      result.bloodPressure.push(...bpData);
      log.info(`Blood pressure: ${bpData.length}`);
    } catch (err) {
      log.error(`Blood pressure error: ${err instanceof Error ? err.message : err}`);
    }

    await sleep(API_DELAY_MS);

    // 歩数データ
    log.info("Fetching steps...");
    try {
      const stepsRes = await api.getSteps(period.from, period.to);
      const stepsData = stepsRes.data || [];
      result.steps.push(...stepsData);
      log.info(`Steps: ${stepsData.length}`);
    } catch (err) {
      log.error(`Steps error: ${err instanceof Error ? err.message : err}`);
    }

    // 次のチャンクの前に待機
    if (i < periods.length - 1) {
      await sleep(API_DELAY_MS * 2);
    }
  }

  log.section("Fetch Summary");
  log.info(`Body composition: ${result.bodyComposition.length}`);
  log.info(`Blood pressure: ${result.bloodPressure.length}`);
  log.info(`Steps: ${result.steps.length}`);

  return result;
}
