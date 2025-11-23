/**
 * Notion データベース検出ツール
 *
 * Notionワークスペース内の全データベースを検索し、
 * TB__METADATAに未登録のデータベースを自動追加します。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read src/services/notion/discover_databases.ts
 */

import "jsr:@std/dotenv/load";
import { notionPost, notionPatch } from "./auth.ts";
import { queryDatabase } from "./api.ts";
import { metadataTableId } from "./auth.ts";
import * as log from "../../utils/log.ts";
import type { NotionApiPage } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

interface NotionSearchResponse {
  results: NotionSearchResult[];
  next_cursor: string | null;
  has_more: boolean;
}

interface NotionSearchResult {
  object: string;
  id: string;
  created_time: string;
  last_edited_time: string;
  title?: Array<{ plain_text: string }>;
  description?: Array<{ plain_text: string }>;
}

interface DiscoveredDatabase {
  id: string;
  title: string;
  description: string;
}

interface DiscoveryResult {
  total: number;
  alreadyRegistered: number;
  newlyAdded: number;
  addedDatabases: DiscoveredDatabase[];
}

// =============================================================================
// Constants
// =============================================================================

const RATE_LIMIT_DELAY_MS = 350; // 3 requests/second

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 検索結果からタイトルを抽出
 */
function extractTitle(result: NotionSearchResult): string {
  if (result.title && result.title.length > 0) {
    return result.title.map((t) => t.plain_text).join("");
  }
  return "Untitled";
}

/**
 * 検索結果からディスクリプションを抽出
 */
function extractDescription(result: NotionSearchResult): string {
  if (result.description && result.description.length > 0) {
    return result.description.map((d) => d.plain_text).join("");
  }
  return "";
}

// =============================================================================
// Search API
// =============================================================================

/**
 * Notionワークスペース内の全データベースを検索
 */
async function searchAllDatabases(): Promise<DiscoveredDatabase[]> {
  const databases: DiscoveredDatabase[] = [];
  let startCursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const body: Record<string, unknown> = {
      filter: {
        property: "object",
        value: "database",
      },
      page_size: 100,
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const response = await notionPost<NotionSearchResponse>("/search", body);

    for (const result of response.results) {
      databases.push({
        id: result.id,
        title: extractTitle(result),
        description: extractDescription(result),
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;

    // レート制限対策
    if (hasMore) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  return databases;
}

// =============================================================================
// Metadata Table Operations
// =============================================================================

/**
 * TB__METADATAから既存のデータベースIDを取得
 */
async function getRegisteredDatabaseIds(): Promise<Set<string>> {
  const pages = await queryDatabase(metadataTableId);
  const databaseIds = new Set<string>();

  for (const page of pages) {
    const properties = page.properties as Record<string, {
      type: string;
      rich_text?: Array<{ plain_text: string }>;
    }>;

    const databaseIdProp = properties["database_id"];
    if (databaseIdProp?.type === "rich_text" && databaseIdProp.rich_text) {
      const id = databaseIdProp.rich_text.map((rt) => rt.plain_text).join("");
      if (id) {
        databaseIds.add(id);
      }
    }
  }

  return databaseIds;
}

/**
 * TB__METADATAに新規データベースを追加
 */
async function addDatabaseToMetadata(database: DiscoveredDatabase): Promise<void> {
  const properties = {
    Name: {
      title: [
        {
          text: {
            content: database.title,
          },
        },
      ],
    },
    database_id: {
      rich_text: [
        {
          text: {
            content: database.id,
          },
        },
      ],
    },
    supabase_table: {
      rich_text: [
        {
          text: {
            content: "", // ユーザーが手動で設定
          },
        },
      ],
    },
    supabase_schema: {
      rich_text: [
        {
          text: {
            content: "notion", // デフォルト
          },
        },
      ],
    },
    // sync_type: デフォルト値を設定せず、ユーザーが選択するまでスキップ
    enabled: {
      checkbox: false, // デフォルトで無効
    },
    description: {
      rich_text: database.description
        ? [
            {
              text: {
                content: database.description,
              },
            },
          ]
        : [],
    },
  };

  await notionPost(`/pages`, {
    parent: {
      database_id: metadataTableId,
    },
    properties,
  });
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * データベース検出と自動登録を実行
 */
export async function discoverAndRegisterDatabases(): Promise<DiscoveryResult> {
  log.section("Discovering Notion databases");

  // 1. 全データベースを検索
  log.info("Searching for databases in workspace...");
  const allDatabases = await searchAllDatabases();
  log.info(`Found ${allDatabases.length} database(s)`);

  // 2. 既に登録済みのデータベースIDを取得
  log.info("Checking registered databases in TB__METADATA...");
  const registeredIds = await getRegisteredDatabaseIds();
  log.info(`Already registered: ${registeredIds.size} database(s)`);

  // 3. 未登録のデータベースを抽出
  const newDatabases = allDatabases.filter((db) => !registeredIds.has(db.id));

  if (newDatabases.length === 0) {
    log.info("No new databases to register");
    return {
      total: allDatabases.length,
      alreadyRegistered: registeredIds.size,
      newlyAdded: 0,
      addedDatabases: [],
    };
  }

  // 4. 新規データベースをTB__METADATAに追加
  log.section(`Registering ${newDatabases.length} new database(s)`);

  const addedDatabases: DiscoveredDatabase[] = [];

  for (const database of newDatabases) {
    try {
      await addDatabaseToMetadata(database);
      addedDatabases.push(database);
      log.success(`Added: "${database.title}" (ID: ${database.id})`);

      // レート制限対策
      await sleep(RATE_LIMIT_DELAY_MS);
    } catch (err) {
      log.error(`Failed to add "${database.title}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    total: allDatabases.length,
    alreadyRegistered: registeredIds.size,
    newlyAdded: addedDatabases.length,
    addedDatabases,
  };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  log.header("Notion Database Discovery");

  try {
    const result = await discoverAndRegisterDatabases();

    // 結果サマリー
    log.section("Summary");
    log.info(`Total databases found: ${result.total}`);
    log.info(`Already registered: ${result.alreadyRegistered}`);
    log.info(`Newly added: ${result.newlyAdded}`);

    if (result.newlyAdded > 0) {
      log.section("Next Steps");
      log.info("To enable synchronization for the new databases:");
      log.info("1. Open TB__METADATA in Notion");
      log.info("2. For each database you want to sync:");
      log.info("   - Set 'supabase_table' (required)");
      log.info("   - Set 'supabase_schema' (default: notion)");
      log.info("   - Set 'sync_type' to master or transaction (required)");
      log.info("   - Check 'enabled' to activate");
      log.info("3. Run sync: deno task sync:notion");
      log.info("");
      log.warn("Note: Databases without 'supabase_table' or 'sync_type' will be skipped");
    }

    log.footer(true);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    log.footer(false);
    Deno.exit(1);
  }
}
