// test/toggl/check_reports_api.ts
// Reports API v3 疎通確認スクリプト
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/toggl/check_reports_api.ts
//
// 必要な環境変数:
//   TOGGL_API_TOKEN, TOGGL_WORKSPACE_ID
//
// 注意:
//   - Reports API は 30 req/hour (Free plan) のクォータ制限あり
//   - このスクリプトは 1-2 リクエストのみ使用

import "jsr:@std/dotenv/load";
import * as log from "../_utils/log.ts";
import {
  fetchEntriesByReportsApi,
  formatDate,
} from "../../src/services/toggl/api.ts";
import { splitDateRange, CHUNK_MONTHS } from "../../src/services/toggl/sync_all.ts";

/** テスト用の短期間（1週間） */
const TEST_DAYS = 7;

async function checkReportsApi(): Promise<void> {
  log.section("[1/2] Reports API v3 Connection");

  // 1週間前から今日まで
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - TEST_DAYS);

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  log.info(`Period: ${startStr} ~ ${endStr} (${TEST_DAYS} days)`);

  const entries = await fetchEntriesByReportsApi(
    startStr,
    endStr,
    (fetched, quota) => {
      const quotaInfo = quota.remaining !== null
        ? ` [Quota: ${quota.remaining} remaining]`
        : "";
      console.log(`  Fetched ${fetched} entries...${quotaInfo}`);
    }
  );

  log.success(`Total entries: ${entries.length}`);

  if (entries.length > 0) {
    const sample = entries[0];
    log.info(`Sample entry:`);
    log.info(`  - id: ${sample.id}`);
    log.info(`  - description: ${sample.description || "(no description)"}`);
    log.info(`  - project: ${sample.project_id || "(no project)"}`);
    log.info(`  - start: ${sample.start}`);
    log.info(`  - duration: ${sample.time_entries?.[0]?.seconds ?? 0}s`);
  }
}

function checkSplitDateRange(): void {
  log.section("[2/2] splitDateRange Logic");

  log.info(`CHUNK_MONTHS = ${CHUNK_MONTHS}`);

  // 2年間の場合
  const start = new Date("2023-01-01");
  const end = new Date("2024-12-31");
  const chunks = splitDateRange(start, end);

  log.info(`2 years (2023-01-01 ~ 2024-12-31):`);
  log.info(`  → ${chunks.length} chunks`);

  // 最初と最後のチャンクを表示
  if (chunks.length > 0) {
    log.info(`  First: ${chunks[0].start} ~ ${chunks[0].end}`);
    log.info(`  Last:  ${chunks[chunks.length - 1].start} ~ ${chunks[chunks.length - 1].end}`);
  }

  // 想定リクエスト数
  log.info(`  Estimated requests: ~${chunks.length * 4} (rate limit triggers wait)`);
}

async function main() {
  log.header("Reports API v3 Check");

  try {
    await checkReportsApi();
    checkSplitDateRange();

    log.footer(true);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    log.footer(false);
    Deno.exit(1);
  }
}

main();
