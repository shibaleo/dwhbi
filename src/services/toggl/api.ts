/**
 * Toggl Track API クライアント
 */

import { togglFetch, workspaceId } from "./auth.ts";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
} from "./types.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Date を YYYY-MM-DD 形式に変換
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * 日付範囲を計算: days日前から今日までを取得
 * @param days 取得する日数
 * @param baseDate 基準日（デフォルト: 現在）- テスト時に固定日付を渡せる
 * @returns start: days日前, end: 明日（APIは排他的終点のため、今日を含めるには明日を指定）
 */
export function getDateRange(
  days: number,
  baseDate: Date = new Date()
): { start: string; end: string } {
  // endDate = baseDate + 1日
  const end = new Date(baseDate);
  end.setDate(end.getDate() + 1);

  // startDate = endDate - (days + 1)
  const start = new Date(end);
  start.setDate(start.getDate() - days - 1);

  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * クライアント一覧を取得
 */
export async function fetchClients(): Promise<TogglApiV9Client[]> {
  return await togglFetch<TogglApiV9Client[]>(
    `/workspaces/${workspaceId}/clients`
  );
}

/**
 * プロジェクト一覧を取得（アーカイブ済み含む）
 */
export async function fetchProjects(): Promise<TogglApiV9Project[]> {
  return await togglFetch<TogglApiV9Project[]>(
    `/workspaces/${workspaceId}/projects`
  );
}

/**
 * タグ一覧を取得
 */
export async function fetchTags(): Promise<TogglApiV9Tag[]> {
  return await togglFetch<TogglApiV9Tag[]>(
    `/workspaces/${workspaceId}/tags`
  );
}

/**
 * 時間エントリーを日付範囲で取得
 * @param startDate 開始日（YYYY-MM-DD）
 * @param endDate 終了日（YYYY-MM-DD）
 */
export async function fetchEntriesByRange(
  startDate: string,
  endDate: string
): Promise<TogglApiV9TimeEntry[]> {
  return await togglFetch<TogglApiV9TimeEntry[]>(
    `/me/time_entries?start_date=${startDate}&end_date=${endDate}`
  );
}

/**
 * 直近N日間の時間エントリーを取得
 * @param days 取得する日数（デフォルト: 3）
 */
export async function fetchEntries(days: number = 3): Promise<TogglApiV9TimeEntry[]> {
  const { start, end } = getDateRange(days);
  return await fetchEntriesByRange(start, end);
}

// =============================================================================
// Reports API v3 Functions
// =============================================================================

import type {
  ReportsApiSearchRequest,
  ReportsApiTimeEntry,
} from "./types.ts";

const REPORTS_API_BASE_URL = "https://api.track.toggl.com/reports/api/v3";
const REPORTS_API_PAGE_SIZE = 1000; // max allowed
const REPORTS_API_MIN_DELAY_MS = 1000; // 1 req/sec (leaky bucket)
const REPORTS_API_QUOTA_BUFFER = 2; // 残りクォータがこの値以下になったら待機

/**
 * Reports API v3 クォータ情報
 */
export interface ReportsApiQuota {
  remaining: number | null;
  resetsInSeconds: number | null;
}

/**
 * Reports API v3 への認証付きPOSTリクエスト
 */
async function reportsFetch<T>(
  endpoint: string,
  body: object
): Promise<{ data: T; headers: Headers; quota: ReportsApiQuota }> {
  const apiToken = Deno.env.get("TOGGL_API_TOKEN")?.trim();
  if (!apiToken) {
    throw new Error("TOGGL_API_TOKEN is not set");
  }

  const url = `${REPORTS_API_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${btoa(`${apiToken}:api_token`)}`,
    },
    body: JSON.stringify(body),
  });

  // クォータ情報を取得
  const quota: ReportsApiQuota = {
    remaining: res.headers.get("X-Toggl-Quota-Remaining")
      ? parseInt(res.headers.get("X-Toggl-Quota-Remaining")!, 10)
      : null,
    resetsInSeconds: res.headers.get("X-Toggl-Quota-Resets-In")
      ? parseInt(res.headers.get("X-Toggl-Quota-Resets-In")!, 10)
      : null,
  };

  // 402: クォータ超過
  if (res.status === 402) {
    const waitSeconds = quota.resetsInSeconds ?? 3600;
    throw new ReportsApiQuotaError(
      `API quota exceeded. Resets in ${waitSeconds} seconds.`,
      waitSeconds
    );
  }

  // 429: Too Many Requests (leaky bucket)
  if (res.status === 429) {
    throw new ReportsApiRateLimitError(
      "Rate limit exceeded (429). Please wait and retry."
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reports API error: ${res.status} ${res.statusText}\n${text}`);
  }

  const data = await res.json();
  return { data, headers: res.headers, quota };
}

/**
 * クォータ超過エラー
 */
export class ReportsApiQuotaError extends Error {
  constructor(
    message: string,
    public readonly resetsInSeconds: number
  ) {
    super(message);
    this.name = "ReportsApiQuotaError";
  }
}

/**
 * レート制限エラー (429)
 */
export class ReportsApiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportsApiRateLimitError";
  }
}

/**
 * Reports API v3 Detailed Report で指定期間の全エントリーを取得（ページネーション対応）
 *
 * @param startDate 開始日 (YYYY-MM-DD)
 * @param endDate 終了日 (YYYY-MM-DD)
 * @param onProgress 進捗コールバック (fetched, quota)
 * @returns 全エントリーの配列
 */
export async function fetchEntriesByReportsApi(
  startDate: string,
  endDate: string,
  onProgress?: (fetched: number, quota: ReportsApiQuota) => void
): Promise<ReportsApiTimeEntry[]> {
  const allEntries: ReportsApiTimeEntry[] = [];
  let firstRowNumber: number | undefined = undefined;
  let requestCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const requestBody: ReportsApiSearchRequest = {
      start_date: startDate,
      end_date: endDate,
      page_size: REPORTS_API_PAGE_SIZE,
      order_by: "date",
      order_dir: "ASC",
    };

    if (firstRowNumber !== undefined) {
      requestBody.first_row_number = firstRowNumber;
    }

    const { data, headers, quota } = await reportsFetch<ReportsApiTimeEntry[]>(
      `/workspace/${workspaceId}/search/time_entries`,
      requestBody
    );
    requestCount++;

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response format: ${JSON.stringify(data)}`);
    }

    allEntries.push(...data);

    onProgress?.(allEntries.length, quota);

    // ページネーションヘッダーを確認
    const nextRowNumber = headers.get("X-Next-Row-Number");

    if (!nextRowNumber || data.length < REPORTS_API_PAGE_SIZE) {
      // これ以上ページがない
      break;
    }

    firstRowNumber = parseInt(nextRowNumber, 10);

    // クォータに基づいて待機時間を決定
    const waitMs = calculateWaitTime(quota, requestCount);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return allEntries;
}

/**
 * クォータに基づいて待機時間を計算
 */
function calculateWaitTime(quota: ReportsApiQuota, requestCount: number): number {
  // クォータ情報が取得できない場合は最低限の待機
  if (quota.remaining === null) {
    return REPORTS_API_MIN_DELAY_MS;
  }

  // クォータが少なくなってきたら、リセットまで待機
  if (quota.remaining <= REPORTS_API_QUOTA_BUFFER) {
    const waitSeconds = quota.resetsInSeconds ?? 3600;
    console.log(`\n⚠️  Quota low (${quota.remaining} remaining). Waiting ${waitSeconds}s for reset...`);
    return waitSeconds * 1000;
  }

  // 通常時は最低限の待機（leaky bucket対策）
  return REPORTS_API_MIN_DELAY_MS;
}
