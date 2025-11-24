/**
 * Notion メタテーブル（TB__METADATA）から同期設定を取得
 *
 * 責務:
 * - メタテーブルからの設定読み込み
 * - 最終同期日時の更新
 */

import { getMetadataTableId } from "./auth.ts";
import { queryDatabase, updatePageProperties } from "./api.ts";
import type {
  SyncConfig,
  NotionApiPage,
  NotionApiPropertyValue,
  NotionApiRichText,
  NotionApiSelectOption,
} from "./types.ts";
import * as log from "../../utils/log.ts";

// =============================================================================
// Helper Functions: Property Value Extraction
// =============================================================================

/**
 * Rich Text配列からプレーンテキストを抽出
 */
function extractRichText(richText: NotionApiRichText[]): string {
  return richText.map((rt) => rt.plain_text).join("");
}

/**
 * プロパティ値からテキストを抽出
 */
function extractTextValue(prop: NotionApiPropertyValue | undefined): string | null {
  if (!prop) return null;

  switch (prop.type) {
    case "title":
      return extractRichText(prop.title) || null;
    case "rich_text":
      return extractRichText(prop.rich_text) || null;
    default:
      return null;
  }
}

/**
 * プロパティ値からSelectの値を抽出
 */
function extractSelectValue(prop: NotionApiPropertyValue | undefined): string | null {
  if (!prop || prop.type !== "select") return null;
  return prop.select?.name ?? null;
}

/**
 * プロパティ値からCheckboxの値を抽出
 */
function extractCheckboxValue(prop: NotionApiPropertyValue | undefined): boolean {
  if (!prop || prop.type !== "checkbox") return false;
  return prop.checkbox;
}

// =============================================================================
// Config Parsing
// =============================================================================

/**
 * NotionページをSyncConfigに変換
 * @returns SyncConfig | null (nullの場合、skipReasonも返す)
 */
function parseSyncConfig(page: NotionApiPage): { config: SyncConfig | null; skipReason?: string } {
  const props = page.properties;

  // 必須フィールドの取得
  const name = extractTextValue(props["Name"]);
  const databaseId = extractTextValue(props["database_id"]);
  const supabaseTable = extractTextValue(props["supabase_table"]);
  const syncTypeRaw = extractSelectValue(props["sync_type"]);

  // 必須フィールドの検証
  if (!name || !databaseId || !supabaseTable || !syncTypeRaw) {
    const displayName = name ?? page.id;
    return { 
      config: null, 
      skipReason: `"${displayName}": missing required fields` 
    };
  }

  // sync_typeの検証
  if (syncTypeRaw !== "master" && syncTypeRaw !== "transaction") {
    return { 
      config: null, 
      skipReason: `"${name}": invalid sync_type "${syncTypeRaw}"` 
    };
  }

  return {
    config: {
      pageId: page.id,
      name,
      databaseId: normalizeNotionId(databaseId),
      supabaseTable,
      supabaseSchema: extractTextValue(props["supabase_schema"]) ?? "raw",
      syncType: syncTypeRaw as "master" | "transaction",
      enabled: extractCheckboxValue(props["enabled"]),
      lastSyncedAt: extractTextValue(props["last_synced_at"]),
      description: extractTextValue(props["description"]),
    },
    skipReason: undefined,
  };
}

/**
 * Notion IDを正規化（ハイフンなしの32文字形式に統一）
 */
function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "");
}

// =============================================================================
// Config Fetch Functions
// =============================================================================

/**
 * メタテーブルから全設定を取得
 */
export async function fetchSyncConfigs(): Promise<SyncConfig[]> {
  log.section("Fetching sync configs from metadata table");

  const metadataTableId = await getMetadataTableId();
  const pages = await queryDatabase(metadataTableId);
  log.info(`Found ${pages.length} config entries`);

  const configs: SyncConfig[] = [];
  const skipped: string[] = [];
  const debug = Deno.env.get("DEBUG")?.toLowerCase() === "true";

  for (const page of pages) {
    const result = parseSyncConfig(page);
    if (result.config) {
      configs.push(result.config);
    } else if (result.skipReason) {
      skipped.push(result.skipReason);
      if (debug) {
        log.warn(`Skipping config ${result.skipReason}`);
      }
    }
  }

  // サマリー表示
  if (skipped.length > 0) {
    log.info(`Skipped ${skipped.length} config${skipped.length > 1 ? 's' : ''} (missing required fields or invalid sync_type)`);
  }
  log.info(`Parsed ${configs.length} valid configs`);

  return configs;
}

/**
 * メタテーブルからenabled=trueの設定のみ取得
 */
export async function fetchEnabledConfigs(): Promise<SyncConfig[]> {
  const allConfigs = await fetchSyncConfigs();
  const enabledConfigs = allConfigs.filter((c) => c.enabled);

  log.info(`Enabled configs: ${enabledConfigs.length}`);

  for (const config of enabledConfigs) {
    log.info(`  - ${config.name} (${config.syncType}) -> ${config.supabaseSchema}.${config.supabaseTable}`);
  }

  return enabledConfigs;
}

/**
 * 特定の設定を名前で取得
 */
export async function fetchConfigByName(name: string): Promise<SyncConfig | null> {
  const allConfigs = await fetchSyncConfigs();
  return allConfigs.find((c) => c.name === name) ?? null;
}

// =============================================================================
// Config Update Functions
// =============================================================================

/**
 * 最終同期日時を更新
 * @param pageId メタテーブルのページID
 * @param timestamp ISO8601形式の日時文字列
 */
export async function updateLastSyncedAt(
  pageId: string,
  timestamp: string
): Promise<void> {
  await updatePageProperties(pageId, {
    last_synced_at: {
      rich_text: [
        {
          type: "text",
          text: { content: timestamp },
        },
      ],
    },
  });
}

// =============================================================================
// CLI Entry Point (for testing)
// =============================================================================

if (import.meta.main) {
  log.header("Notion Metadata Fetch Test");

  const configs = await fetchEnabledConfigs();

  console.log("\nEnabled Configs:");
  for (const config of configs) {
    console.log(`\n  ${config.name}:`);
    console.log(`    Database ID: ${config.databaseId}`);
    console.log(`    Target: ${config.supabaseSchema}.${config.supabaseTable}`);
    console.log(`    Sync Type: ${config.syncType}`);
    console.log(`    Last Synced: ${config.lastSyncedAt ?? "never"}`);
  }

  log.footer(true);
}
