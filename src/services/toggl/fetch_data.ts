/**
 * Toggl Track API データ取得オーケストレーション
 *
 * 責務:
 * - API制約（レート制限）の吸収
 * - 長期間リクエストの自動チャンク分割（12ヶ月単位）
 * - 進捗報告（コールバック経由）
 */

import {
  fetchClients,
  fetchProjects,
  fetchTags,
  fetchEntriesByRange,
  fetchEntriesSince,
  fetchEntriesIncremental,
  fetchEntriesByReportsApi,
  formatTogglDate,
  ReportsApiQuotaError,
  ReportsApiRateLimitError,
} from "./api.ts";
import type { ReportsApiQuota } from "./api.ts";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
  ReportsApiTimeEntry,
} from "./types.ts";
import * as log from "../../utils/log.ts";

// =============================================================================
// Constants
// =============================================================================

/** チャンクサイズ（12ヶ月単位） */
export const CHUNK_MONTHS = 12;

// =============================================================================
// Date Range Calculation
// =============================================================================

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
    start: formatTogglDate(start),
    end: formatTogglDate(end),
  };
}

// =============================================================================
// Types
// =============================================================================

/**
 * 日次同期用データ（v9 API）
 */
export interface TogglData {
  clients: TogglApiV9Client[];
  projects: TogglApiV9Project[];
  tags: TogglApiV9Tag[];
  entries: TogglApiV9TimeEntry[];
}

/**
 * メタデータのみ（clients, projects, tags）
 */
export interface TogglMetadata {
  clients: TogglApiV9Client[];
  projects: TogglApiV9Project[];
  tags: TogglApiV9Tag[];
}

/**
 * 全件同期用データ（Reports API v3）
 */
export interface TogglFullData {
  clients: TogglApiV9Client[];
  projects: TogglApiV9Project[];
  tags: TogglApiV9Tag[];
  entries: ReportsApiTimeEntry[];
}

/**
 * 進捗コールバック
 */
export type ProgressCallback = (progress: {
  chunkIndex: number;
  totalChunks: number;
  chunkStart: string;
  chunkEnd: string;
  entriesFetched: number;
  quota: ReportsApiQuota;
}) => void;

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 日付範囲を12ヶ月チャンクに分割
 */
export function splitDateRange(
  startDate: Date,
  endDate: Date,
  chunkMonths: number = CHUNK_MONTHS
): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setMonth(chunkEnd.getMonth() + chunkMonths);

    const actualEnd = chunkEnd > endDate ? endDate : chunkEnd;

    chunks.push({
      start: formatTogglDate(current),
      end: formatTogglDate(actualEnd),
    });

    current = new Date(actualEnd);
    current.setDate(current.getDate() + 1);
  }

  return chunks;
}

// =============================================================================
// Metadata Fetch
// =============================================================================

/**
 * メタデータのみ取得（clients, projects, tags）
 */
export async function fetchTogglMetadata(): Promise<TogglMetadata> {
  log.section("Fetching metadata from Toggl API");

  // 並列取得（staggered delay）
  const [clients, projects, tags] = await Promise.all([
    fetchClients(),
    sleep(200).then(() => fetchProjects()),
    sleep(400).then(() => fetchTags()),
  ]);

  log.info(`Clients: ${clients.length}`);
  log.info(`Projects: ${projects.length}`);
  log.info(`Tags: ${tags.length}`);

  return { clients, projects, tags };
}

// =============================================================================
// Daily Sync (v9 API)
// =============================================================================

/**
 * 日次同期用データ取得（v9 API）
 *
 * @param days エントリーを取得する日数
 */
export async function fetchTogglData(days: number = 3): Promise<TogglData> {
  // 日付範囲を計算
  const { start, end } = getDateRange(days);

  const [clients, projects, tags, entries] = await Promise.all([
    fetchClients(),
    sleep(200).then(() => fetchProjects()),
    sleep(400).then(() => fetchTags()),
    sleep(600).then(() => fetchEntriesByRange(start, end)),
  ]);

  return { clients, projects, tags, entries };
}

// =============================================================================
// Full Sync (Reports API v3)
// =============================================================================

/**
 * 全件同期用データ取得（Reports API v3）
 *
 * 12ヶ月単位でチャンク分割し、レート制限エラー時は自動で待機・リトライ
 *
 * @param startDate 開始日
 * @param endDate 終了日
 * @param onProgress 進捗コールバック（オプション）
 */
export async function fetchTogglDataWithChunks(
  startDate: Date,
  endDate: Date,
  onProgress?: ProgressCallback
): Promise<TogglFullData> {
  // 1. メタデータ取得
  const { clients, projects, tags } = await fetchTogglMetadata();

  // 2. エントリー取得（12ヶ月チャンク）
  log.section("Fetching entries from Reports API v3");

  const chunks = splitDateRange(startDate, endDate);
  log.info(`Total chunks: ${chunks.length} (${CHUNK_MONTHS}-month intervals)`);

  const allEntries: ReportsApiTimeEntry[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    log.info(`Chunk ${i + 1}/${chunks.length}: ${chunk.start} ~ ${chunk.end}`);

    let success = false;
    while (!success) {
      try {
        const entries = await fetchEntriesByReportsApi(
          chunk.start,
          chunk.end,
          (fetched: number, quota: ReportsApiQuota) => {
            // 進捗コールバック
            if (onProgress) {
              onProgress({
                chunkIndex: i,
                totalChunks: chunks.length,
                chunkStart: chunk.start,
                chunkEnd: chunk.end,
                entriesFetched: fetched,
                quota,
              });
            }
          }
        );

        allEntries.push(...entries);
        log.success(`  ${entries.length} entries`);
        success = true;
      } catch (err) {
        if (err instanceof ReportsApiQuotaError) {
          log.warn(`Quota exceeded. Waiting ${err.resetsInSeconds}s for reset...`);
          await sleep(err.resetsInSeconds * 1000);
          continue;
        }

        if (err instanceof ReportsApiRateLimitError) {
          log.warn(`Rate limited (429). Waiting 60s...`);
          await sleep(60000);
          continue;
        }

        // その他のエラーは再スロー
        throw err;
      }
    }
  }

  log.success(`Total Entries: ${allEntries.length}`);

  return { clients, projects, tags, entries: allEntries };
}

// =============================================================================
// Legacy Export (for backward compatibility)
// =============================================================================

/**
 * @deprecated Use fetchTogglData instead
 */
export const fetchAllData = fetchTogglData;

// =============================================================================
// Incremental Sync (差分同期)
// =============================================================================

/**
 * 差分同期用データ取得
 *
 * - sinceTimestamp が指定された場合: `since` パラメータで差分取得
 * - 指定されていない場合: 日付範囲で取得（初回同期・フルリフレッシュ用）
 *
 * @param options 取得オプション
 * @returns 取得データと同期モード
 */
export async function fetchTogglDataIncremental(options: {
  /** UNIXタイムスタンプ（秒）- この時刻以降の更新を取得 */
  sinceTimestamp?: number;
  /** フルリフレッシュ時の日数（デフォルト: 3） */
  fallbackDays?: number;
  /** メタデータも取得するか（デフォルト: true） */
  includeMetadata?: boolean;
}): Promise<{
  clients: TogglApiV9Client[];
  projects: TogglApiV9Project[];
  tags: TogglApiV9Tag[];
  entries: TogglApiV9TimeEntry[];
  mode: 'incremental' | 'full';
  apiCalls: number;
}> {
  const includeMetadata = options.includeMetadata ?? true;
  let apiCalls = 0;

  // メタデータ取得（オプション）
  let clients: TogglApiV9Client[] = [];
  let projects: TogglApiV9Project[] = [];
  let tags: TogglApiV9Tag[] = [];

  if (includeMetadata) {
    const metadata = await fetchTogglMetadata();
    clients = metadata.clients;
    projects = metadata.projects;
    tags = metadata.tags;
    apiCalls += 3;
  }

  // エントリー取得
  if (options.sinceTimestamp) {
    // 差分同期: since パラメータを使用
    log.info(`Fetching entries since ${new Date(options.sinceTimestamp * 1000).toISOString()}`);
    const entries = await fetchEntriesSince(options.sinceTimestamp);
    apiCalls += 1;

    return {
      clients,
      projects,
      tags,
      entries,
      mode: 'incremental',
      apiCalls,
    };
  }

  // フルリフレッシュ: 日付範囲を使用
  const days = options.fallbackDays ?? 3;
  const { start, end } = getDateRange(days);
  log.info(`Fetching entries from ${start} to ${end} (${days} days)`);
  const entries = await fetchEntriesByRange(start, end);
  apiCalls += 1;

  return {
    clients,
    projects,
    tags,
    entries,
    mode: 'full',
    apiCalls,
  };
}
