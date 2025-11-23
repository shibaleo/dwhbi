/**
 * Notion型 ↔ PostgreSQL型 の変換ロジック
 *
 * 責務:
 * - プロパティ名のカラム名変換
 * - Notion型からPostgreSQL型へのマッピング
 * - プロパティ値の抽出
 * - DDL生成
 */

import type {
  NotionApiPropertySchema,
  NotionApiPropertyValue,
  NotionApiRichText,
  SyncConfig,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/**
 * Notion型 → PostgreSQL型マッピング
 */
const TYPE_MAPPING: Record<string, string> = {
  title: "text NOT NULL",
  rich_text: "text",
  number: "numeric",
  checkbox: "boolean",
  date: "jsonb",
  select: "text",
  multi_select: "text[]",
  status: "text",
  url: "text",
  email: "text",
  phone_number: "text",
  relation: "text[]",
  rollup: "jsonb",
  formula: "jsonb", // 計算結果の型が変わる可能性があるため
  files: "jsonb",
  people: "text[]",
  created_time: "timestamptz",
  created_by: "text",
  last_edited_time: "timestamptz",
  last_edited_by: "text",
  unique_id: "text",
};

/**
 * 予約済みカラム名（共通カラムとして追加されるもの）
 */
const RESERVED_COLUMNS = new Set(["id", "created_at", "updated_at", "synced_at"]);

// =============================================================================
// Column Name Conversion
// =============================================================================

/**
 * Notionプロパティ名をPostgreSQLカラム名に変換
 *
 * 変換ルール:
 * 1. 小文字に変換
 * 2. スペース、ハイフン、括弧を _ に置換
 * 3. 連続する _ を1つに
 * 4. 先頭・末尾の _ を削除
 *
 * @example
 * propertyNameToColumn("1st-period(min)") // → "1st_period_min"
 * propertyNameToColumn("Date")             // → "date"
 */
export function propertyNameToColumn(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\-\(\)\/\\]+/g, "_") // スペース、ハイフン、括弧、スラッシュを_に
    .replace(/_+/g, "_") // 連続する_を1つに
    .replace(/^_+|_+$/g, ""); // 先頭・末尾の_を削除
}

// =============================================================================
// Type Mapping
// =============================================================================

/**
 * Notion型からPostgreSQL型を取得
 * @param notionType Notionのプロパティ型
 */
export function notionTypeToPostgres(notionType: string): string {
  return TYPE_MAPPING[notionType] ?? "text";
}

// =============================================================================
// Property Value Extraction
// =============================================================================

/**
 * Rich Text配列からプレーンテキストを抽出
 */
function extractRichText(richText: NotionApiRichText[]): string {
  return richText.map((rt) => rt.plain_text).join("");
}

/**
 * NotionプロパティからJavaScriptの値を抽出
 *
 * @param prop Notionプロパティ値
 * @returns 抽出された値（型はNotionプロパティ型に依存）
 */
export function extractPropertyValue(prop: NotionApiPropertyValue): unknown {
  switch (prop.type) {
    case "title":
      return extractRichText(prop.title);

    case "rich_text":
      return extractRichText(prop.rich_text);

    case "number":
      return prop.number;

    case "checkbox":
      return prop.checkbox;

    case "date":
      // JSONBとして保存（start, end, time_zone構造を維持）
      return prop.date;

    case "select":
      return prop.select?.name ?? null;

    case "multi_select":
      return prop.multi_select.map((s) => s.name);

    case "status":
      return prop.status?.name ?? null;

    case "url":
      return prop.url;

    case "email":
      return prop.email;

    case "phone_number":
      return prop.phone_number;

    case "relation":
      return prop.relation.map((r) => r.id);

    case "rollup":
      // JSONBとして保存
      return prop.rollup;

    case "formula":
      // 計算結果をJSONBとして保存
      return prop.formula;

    case "files":
      // ファイル情報をJSONBとして保存
      return prop.files;

    case "people":
      return prop.people.map((p) => p.id);

    case "created_time":
      return prop.created_time;

    case "created_by":
      return prop.created_by.id;

    case "last_edited_time":
      return prop.last_edited_time;

    case "last_edited_by":
      return prop.last_edited_by.id;

    case "unique_id":
      const uid = prop.unique_id;
      return uid.prefix ? `${uid.prefix}-${uid.number}` : String(uid.number);

    default:
      // 未知の型はnullを返す
      return null;
  }
}

// =============================================================================
// DDL Generation
// =============================================================================

/**
 * CREATE TABLE文を生成
 */
export function generateCreateTableDDL(
  config: SyncConfig,
  properties: Record<string, NotionApiPropertySchema>
): string {
  const tableName = `${config.supabaseSchema}.${config.supabaseTable}`;
  const columns: string[] = [];

  // 共通カラム
  columns.push("id text PRIMARY KEY");
  columns.push("created_at timestamptz");
  columns.push("updated_at timestamptz");
  columns.push("synced_at timestamptz DEFAULT now()");

  // プロパティカラム
  for (const [propName, propSchema] of Object.entries(properties)) {
    const columnName = propertyNameToColumn(propName);

    // 予約済みカラムはスキップ
    if (RESERVED_COLUMNS.has(columnName)) {
      continue;
    }

    const pgType = notionTypeToPostgres(propSchema.type);
    columns.push(`"${columnName}" ${pgType}`);
  }

  const ddl = `CREATE TABLE ${tableName} (
  ${columns.join(",\n  ")}
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_${config.supabaseTable}_created_at ON ${tableName} (created_at);
CREATE INDEX IF NOT EXISTS idx_${config.supabaseTable}_updated_at ON ${tableName} (updated_at);

-- GRANT権限（PostgRESTアクセス用）
GRANT ALL ON ${tableName} TO postgres, anon, authenticated, service_role;

-- RLS有効化
ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;

-- Service Role用ポリシー
CREATE POLICY "Service role full access" ON ${tableName}
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Authenticated read access
CREATE POLICY "Authenticated read access" ON ${tableName}
  FOR SELECT
  USING (auth.role() = 'authenticated');`;

  return ddl;
}

/**
 * ALTER TABLE文を生成（カラム追加）
 */
export function generateAlterTableAddColumnDDL(
  config: SyncConfig,
  columnName: string,
  notionType: string
): string {
  const tableName = `${config.supabaseSchema}.${config.supabaseTable}`;
  const pgType = notionTypeToPostgres(notionType);

  return `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${columnName}" ${pgType};`;
}

/**
 * スキーマ差分からALTER TABLE文を生成
 */
export function generateAlterTableDDL(
  config: SyncConfig,
  addedColumns: Array<{ name: string; type: string }>,
  removedColumns: string[]
): string[] {
  const tableName = `${config.supabaseSchema}.${config.supabaseTable}`;
  const ddls: string[] = [];

  // カラム追加
  for (const col of addedColumns) {
    const pgType = notionTypeToPostgres(col.type);
    ddls.push(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${col.name}" ${pgType};`);
  }

  // 削除されたカラムは警告のみ（自動削除は危険）
  if (removedColumns.length > 0) {
    ddls.push(`-- WARNING: The following columns exist in Supabase but not in Notion:`);
    for (const col of removedColumns) {
      ddls.push(`-- ${col}`);
    }
    ddls.push(`-- Manual review required before dropping these columns.`);
  }

  return ddls;
}

// =============================================================================
// Schema Analysis
// =============================================================================

/**
 * Notionプロパティからカラム定義を抽出
 */
export function extractColumnDefinitions(
  properties: Record<string, NotionApiPropertySchema>
): Array<{ name: string; type: string; notionType: string }> {
  const columns: Array<{ name: string; type: string; notionType: string }> = [];

  for (const [propName, propSchema] of Object.entries(properties)) {
    const columnName = propertyNameToColumn(propName);

    // 予約済みカラムはスキップ
    if (RESERVED_COLUMNS.has(columnName)) {
      continue;
    }

    columns.push({
      name: columnName,
      type: notionTypeToPostgres(propSchema.type),
      notionType: propSchema.type,
    });
  }

  return columns;
}
