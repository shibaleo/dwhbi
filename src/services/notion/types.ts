/**
 * Notion 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

import { RateLimitError } from "../../utils/errors.ts";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Notion API レート制限エラー（429 Too Many Requests）
 */
export class NotionRateLimitError extends RateLimitError {
  constructor(retryAfterSeconds: number = 60, message?: string) {
    super(
      retryAfterSeconds,
      message ?? `Notion API rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`
    );
    this.name = "NotionRateLimitError";
  }
}

// =============================================================================
// Notion API Response Types
// =============================================================================

/**
 * Notion Rich Text
 */
export interface NotionApiRichText {
  type: "text" | "mention" | "equation";
  text?: {
    content: string;
    link?: { url: string } | null;
  };
  mention?: unknown;
  equation?: { expression: string };
  annotations?: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  plain_text: string;
  href?: string | null;
}

/**
 * Notion Date
 */
export interface NotionApiDate {
  start: string;
  end?: string | null;
  time_zone?: string | null;
}

/**
 * Notion Select Option
 */
export interface NotionApiSelectOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * Notion File
 */
export interface NotionApiFile {
  type: "file" | "external";
  file?: { url: string; expiry_time: string };
  external?: { url: string };
  name?: string;
}

/**
 * Notion User
 */
export interface NotionApiUser {
  object: "user";
  id: string;
  name?: string;
  avatar_url?: string | null;
  type?: "person" | "bot";
  person?: { email: string };
  bot?: unknown;
}

/**
 * Notion Rollup
 */
export interface NotionApiRollup {
  type: "number" | "date" | "array";
  number?: number | null;
  date?: NotionApiDate | null;
  array?: NotionApiPropertyValue[];
  function?: string;
}

/**
 * Notion Formula
 */
export interface NotionApiFormula {
  type: "string" | "number" | "boolean" | "date";
  string?: string | null;
  number?: number | null;
  boolean?: boolean | null;
  date?: NotionApiDate | null;
}

/**
 * Notion Property Value（ページ内）
 */
export type NotionApiPropertyValue =
  | { type: "title"; title: NotionApiRichText[]; id: string }
  | { type: "rich_text"; rich_text: NotionApiRichText[]; id: string }
  | { type: "number"; number: number | null; id: string }
  | { type: "select"; select: NotionApiSelectOption | null; id: string }
  | { type: "multi_select"; multi_select: NotionApiSelectOption[]; id: string }
  | { type: "status"; status: NotionApiSelectOption | null; id: string }
  | { type: "date"; date: NotionApiDate | null; id: string }
  | { type: "people"; people: NotionApiUser[]; id: string }
  | { type: "files"; files: NotionApiFile[]; id: string }
  | { type: "checkbox"; checkbox: boolean; id: string }
  | { type: "url"; url: string | null; id: string }
  | { type: "email"; email: string | null; id: string }
  | { type: "phone_number"; phone_number: string | null; id: string }
  | { type: "formula"; formula: NotionApiFormula; id: string }
  | { type: "relation"; relation: { id: string }[]; id: string }
  | { type: "rollup"; rollup: NotionApiRollup; id: string }
  | { type: "created_time"; created_time: string; id: string }
  | { type: "created_by"; created_by: NotionApiUser; id: string }
  | { type: "last_edited_time"; last_edited_time: string; id: string }
  | { type: "last_edited_by"; last_edited_by: NotionApiUser; id: string }
  | { type: "unique_id"; unique_id: { prefix: string | null; number: number }; id: string };

/**
 * Notion Property Schema（データベース定義）
 */
export interface NotionApiPropertySchema {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Notion Database
 * GET /v1/databases/{id}
 */
export interface NotionApiDatabase {
  object: "database";
  id: string;
  created_time: string;
  last_edited_time: string;
  title: NotionApiRichText[];
  description: NotionApiRichText[];
  icon?: { type: string; emoji?: string; file?: NotionApiFile; external?: { url: string } } | null;
  cover?: NotionApiFile | null;
  properties: Record<string, NotionApiPropertySchema>;
  parent: { type: string; page_id?: string; workspace?: boolean };
  url: string;
  archived: boolean;
  is_inline: boolean;
  public_url?: string | null;
}

/**
 * Notion Page
 * POST /v1/databases/{id}/query のレスポンス内
 */
export interface NotionApiPage {
  object: "page";
  id: string;
  created_time: string;
  last_edited_time: string;
  created_by: NotionApiUser;
  last_edited_by: NotionApiUser;
  cover?: NotionApiFile | null;
  icon?: { type: string; emoji?: string; file?: NotionApiFile; external?: { url: string } } | null;
  parent: { type: string; database_id?: string; page_id?: string; workspace?: boolean };
  archived: boolean;
  properties: Record<string, NotionApiPropertyValue>;
  url: string;
  public_url?: string | null;
}

/**
 * Notion Query Response
 * POST /v1/databases/{id}/query
 */
export interface NotionApiQueryResponse {
  object: "list";
  results: NotionApiPage[];
  next_cursor: string | null;
  has_more: boolean;
  type: "page_or_database";
  page_or_database: Record<string, never>;
}

// =============================================================================
// Sync Config Types（メタテーブルから読み込む設定）
// =============================================================================

/**
 * 同期設定（TB__METADATAから取得）
 */
export interface SyncConfig {
  /** メタテーブルのページID */
  pageId: string;
  /** 識別名（例: "GCAL_MAPPING"） */
  name: string;
  /** 同期対象のNotion DB ID */
  databaseId: string;
  /** Supabase側のテーブル名 */
  supabaseTable: string;
  /** Supabase側のスキーマ名（デフォルト: "notion"） */
  supabaseSchema: string;
  /** 同期タイプ */
  syncType: "master" | "transaction";
  /** 同期を有効にするか */
  enabled: boolean;
  /** 最終同期日時（ISO8601） */
  lastSyncedAt: string | null;
  /** メモ */
  description: string | null;
}

// =============================================================================
// Database Table Types (notion schema)
// =============================================================================

/**
 * 共通カラム（全テーブルに自動追加）
 */
export interface DbCommonColumns {
  id: string; // Notion ページID
  created_at: string; // Notion created_time
  updated_at: string; // Notion last_edited_time
  synced_at?: string; // 同期日時（Supabase側で自動設定）
}

/**
 * 動的テーブルレコード（プロパティは動的）
 */
export type DbRecord = DbCommonColumns & Record<string, unknown>;

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

/**
 * データ取得オプション
 */
export interface FetchOptions {
  /** 開始日（transaction同期用） */
  startDate?: Date;
  /** 終了日 */
  endDate?: Date;
}

/**
 * テーブル同期用データ
 */
export interface NotionTableData {
  config: SyncConfig;
  pages: NotionApiPage[];
  properties: Record<string, NotionApiPropertySchema>;
}

// =============================================================================
// Sync Result Types
// =============================================================================

/**
 * テーブル単位の同期統計
 */
export interface TableSyncStats {
  table: string;
  fetched: number;
  saved: number;
  failed: number;
}

/**
 * 同期統計
 */
export interface SyncStats {
  tables: TableSyncStats[];
  totalFetched: number;
  totalSaved: number;
  totalFailed: number;
}

/**
 * 同期結果
 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  errors: string[];
  elapsedSeconds: number;
}

// =============================================================================
// Schema Sync Types
// =============================================================================

/**
 * スキーマ比較結果
 */
export interface SchemaComparison {
  tableName: string;
  exists: boolean;
  addedColumns: string[];
  removedColumns: string[];
  ddl: string[];
}

/**
 * DDL生成結果
 */
export interface SchemaGenerationResult {
  comparisons: SchemaComparison[];
  allDDL: string[];
}

// =============================================================================
// Constants
// =============================================================================

/** Notion API バージョン */
export const NOTION_API_VERSION = "2022-06-28";

/** Notion API ベースURL */
export const NOTION_API_BASE_URL = "https://api.notion.com/v1";

/** クエリ時の最大ページサイズ */
export const NOTION_QUERY_PAGE_SIZE = 100;

/** レート制限時の待機秒数 */
export const NOTION_RATE_LIMIT_WAIT_SECONDS = 60;
