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
