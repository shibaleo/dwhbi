// fetch_data.ts
// Tanita Health Planet API からのデータ取得オーケストレーション

import { TanitaAPI } from "./api.ts";
import type { FetchOptions, TanitaData, TanitaDataItem } from "./types.ts";

// ========== 定数 ==========

// Tanita API は最大3ヶ月間のデータしか取得できない
const MAX_DAYS = 90;
const API_DELAY_MS = 200; // API呼び出し間の待機時間（レート制限: 60回/時間）

// ========== ヘルパー ==========

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

// ========== メイン関数 ==========

/**
 * 指定期間のTanitaデータを取得
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

  console.log(
    `📅 取得期間: ${startDate.toISOString().split("T")[0]} 〜 ${
      endDate.toISOString().split("T")[0]
    }`,
  );
  console.log(`   チャンク数: ${periods.length}（最大3ヶ月ずつ）\n`);

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const periodStr = `${period.from.toISOString().split("T")[0]} 〜 ${
      period.to.toISOString().split("T")[0]
    }`;

    if (periods.length > 1) {
      console.log(`━━━ チャンク ${i + 1}/${periods.length}: ${periodStr} ━━━`);
    }

    // 体組成データ
    console.log("🏋️  体組成データ取得中...");
    try {
      const bodyRes = await api.getBodyComposition(period.from, period.to);
      const bodyData = bodyRes.data || [];
      result.bodyComposition.push(...bodyData);
      console.log(`   取得: ${bodyData.length}件`);
    } catch (error) {
      console.error(
        `   ❌ エラー: ${error instanceof Error ? error.message : error}`,
      );
    }

    await sleep(API_DELAY_MS);

    // 血圧データ
    console.log("🩺 血圧データ取得中...");
    try {
      const bpRes = await api.getBloodPressure(period.from, period.to);
      const bpData = bpRes.data || [];
      result.bloodPressure.push(...bpData);
      console.log(`   取得: ${bpData.length}件`);
    } catch (error) {
      console.error(
        `   ❌ エラー: ${error instanceof Error ? error.message : error}`,
      );
    }

    await sleep(API_DELAY_MS);

    // 歩数データ
    console.log("👟 歩数データ取得中...");
    try {
      const stepsRes = await api.getSteps(period.from, period.to);
      const stepsData = stepsRes.data || [];
      result.steps.push(...stepsData);
      console.log(`   取得: ${stepsData.length}件`);
    } catch (error) {
      console.error(
        `   ❌ エラー: ${error instanceof Error ? error.message : error}`,
      );
    }

    // 次のチャンクの前に待機
    if (i < periods.length - 1) {
      await sleep(API_DELAY_MS * 2);
    }
  }

  console.log(
    `\n📊 取得完了: 体組成${result.bodyComposition.length}件, 血圧${result.bloodPressure.length}件, 歩数${result.steps.length}件`,
  );

  return result;
}
