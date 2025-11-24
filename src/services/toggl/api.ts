/**
 * Toggl Track API クライアント
 */

import { togglFetch, getWorkspaceId } from "./auth.ts";
import {
  type TogglApiV9Client,
  type TogglApiV9Project,
  type TogglApiV9Tag,
  type TogglApiV9TimeEntry,
  ReportsApiQuotaError,
  ReportsApiRateLimitError,
} from "./types.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Date を YYYY-MM-DD 形式に変換
 */
export function formatTogglDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * クライアント一覧を取得
 */
export async function fetchClients(): Promise<TogglApiV9Client[]> {
  const workspaceId = await getWorkspaceId();
  return await togglFetch<TogglApiV9Client[]>(
    `/workspaces/${workspaceId}/clients`
  );
}

/**
 * プロジェクト一覧を取得（アーカイブ済み含む）
 */
export async function fetchProjects(): Promise<TogglApiV9Project[]> {
  const workspaceId = await getWorkspaceId();
  return await togglFetch<TogglApiV9Project[]>(
    `/workspaces/${workspaceId}/projects`
  );
}

/**
 * タグ一覧を取得
 */
export async function fetchTags(): Promise<TogglApiV9Tag[]> {
  const workspaceId = await getWorkspaceId();
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
 * 指定時刻以降に更新されたエントリーを取得（差分同期用）
 * 
 * Toggl API v9 の `since` パラメータを使用して、
 * 指定したUNIXタイムスタンプ以降に更新されたエントリーのみを取得する。
 * 
 * @param sinceTimestamp UNIXタイムスタンプ（秒）
 * @returns 更新されたエントリーの配列
 */
export async function fetchEntriesSince(
  sinceTimestamp: number
): Promise<TogglApiV9TimeEntry[]> {
  return await togglFetch<TogglApiV9TimeEntry[]>(
    `/me/time_entries?since=${sinceTimestamp}`
  );
}

/**
 * 差分同期用のエントリー取得
 * 
 * - sinceTimestamp が指定された場合: `since` パラメータで差分取得
 * - 指定されていない場合: 日付範囲で取得（初回同期・フルリフレッシュ用）
 * 
 * @param options 取得オプション
 * @returns エントリーの配列
 */
export async function fetchEntriesIncremental(options: {
  sinceTimestamp?: number;
  startDate?: string;
  endDate?: string;
}): Promise<{ entries: TogglApiV9TimeEntry[]; mode: 'incremental' | 'full' }> {
  if (options.sinceTimestamp) {
    // 差分同期: since パラメータを使用
    const entries = await fetchEntriesSince(options.sinceTimestamp);
    return { entries, mode: 'incremental' };
  }
  
  // フルリフレッシュ: 日付範囲を使用
  if (!options.startDate || !options.endDate) {
    throw new Error('startDate and endDate are required for full sync');
  }
  const entries = await fetchEntriesByRange(options.startDate, options.endDate);
  return { entries, mode: 'full' };
}

// =============================================================================
// Reports API v3 Functions
// =============================================================================

import type {
  ReportsApiSearchRequest,
  ReportsApiTimeEntry,
} from "./types.ts";

// Re-export for backward compatibility
export { ReportsApiQuotaError, ReportsApiRateLimitError } from "./types.ts";

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

import {
  getCredentials,
  type BasicCredentials,
} from "../../utils/credentials.ts";

/**
 * Reports API v3 への認証付きPOSTリクエスト
 */
async function reportsFetch<T>(
  endpoint: string,
  body: object
): Promise<{ data: T; headers: Headers; quota: ReportsApiQuota }> {
  const result = await getCredentials<BasicCredentials>("toggl");
  if (!result) {
    throw new Error("Toggl credentials not found in credentials.services");
  }
  const apiToken = result.credentials.api_token;

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
    throw new ReportsApiQuotaError(waitSeconds);
  }

  // 429: Too Many Requests (leaky bucket)
  if (res.status === 429) {
    throw new ReportsApiRateLimitError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reports API error: ${res.status} ${res.statusText}\n${text}`);
  }

  const data = await res.json();
  return { data, headers: res.headers, quota };
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
      `/workspace/${await getWorkspaceId()}/search/time_entries`,
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
