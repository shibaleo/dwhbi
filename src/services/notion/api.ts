/**
 * Notion API クライアント
 *
 * データベースの構造取得、ページのクエリを提供
 */

import { notionFetch, notionPost, notionPatch } from "./auth.ts";
import type {
  NotionApiDatabase,
  NotionApiPage,
  NotionApiQueryResponse,
} from "./types.ts";
import { NOTION_QUERY_PAGE_SIZE, NotionRateLimitError } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const RATE_LIMIT_DELAY_MS = 350; // 3 requests/second = 333ms 間隔

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Re-export
// =============================================================================

export { NotionRateLimitError } from "./types.ts";

// =============================================================================
// API Functions
// =============================================================================

/**
 * データベース構造（プロパティ定義）を取得
 * @param databaseId Notion Database ID
 */
export async function getDatabase(databaseId: string): Promise<NotionApiDatabase> {
  return await notionFetch<NotionApiDatabase>(`/databases/${databaseId}`);
}

/**
 * データベースからページ一覧を取得（ページネーション対応）
 * @param databaseId Notion Database ID
 * @param filter フィルター条件（オプション）
 * @param sorts ソート条件（オプション）
 */
export async function queryDatabase(
  databaseId: string,
  filter?: object,
  sorts?: object[]
): Promise<NotionApiPage[]> {
  const allPages: NotionApiPage[] = [];
  let startCursor: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, unknown> = {
      page_size: NOTION_QUERY_PAGE_SIZE,
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    if (filter) {
      body.filter = filter;
    }

    if (sorts) {
      body.sorts = sorts;
    }

    const response = await notionPost<NotionApiQueryResponse>(
      `/databases/${databaseId}/query`,
      body
    );

    allPages.push(...response.results);

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;

    // レート制限対策
    if (hasMore) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  return allPages;
}

/**
 * 指定日時以降に編集されたページを取得
 * @param databaseId Notion Database ID
 * @param afterIso ISO8601形式の日時文字列
 */
export async function queryDatabaseByLastEdited(
  databaseId: string,
  afterIso: string
): Promise<NotionApiPage[]> {
  const filter = {
    timestamp: "last_edited_time",
    last_edited_time: {
      after: afterIso,
    },
  };

  return await queryDatabase(databaseId, filter);
}

/**
 * ページのプロパティを更新
 * @param pageId Notion Page ID
 * @param properties 更新するプロパティ
 */
export async function updatePageProperties(
  pageId: string,
  properties: Record<string, unknown>
): Promise<NotionApiPage> {
  return await notionPatch<NotionApiPage>(`/pages/${pageId}`, { properties });
}

/**
 * ページを取得
 * @param pageId Notion Page ID
 */
export async function getPage(pageId: string): Promise<NotionApiPage> {
  return await notionFetch<NotionApiPage>(`/pages/${pageId}`);
}
