/**
 * Toggl Track API データ取得オーケストレーション
 */

import {
  fetchClients,
  fetchProjects,
  fetchTags,
  fetchEntries,
} from "./api.ts";
import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
} from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * 全データの取得結果
 */
export interface TogglData {
  clients: TogglApiV9Client[];
  projects: TogglApiV9Project[];
  tags: TogglApiV9Tag[];
  entries: TogglApiV9TimeEntry[];
}

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * 全データを並列取得（staggered delay でAPIバーストを回避）
 * @param days エントリーを取得する日数
 */
export async function fetchTogglData(days: number = 3): Promise<TogglData> {
  const [clients, projects, tags, entries] = await Promise.all([
    // clients: 即座に開始
    fetchClients(),

    // projects: 200ms後に開始
    sleep(200).then(() => fetchProjects()),

    // tags: 400ms後に開始
    sleep(400).then(() => fetchTags()),

    // entries: 600ms後に開始
    sleep(600).then(() => fetchEntries(days)),
  ]);

  return { clients, projects, tags, entries };
}

// =============================================================================
// Legacy Export (for backward compatibility)
// =============================================================================

/**
 * @deprecated Use fetchTogglData instead
 */
export const fetchAllData = fetchTogglData;
