/**
 * Notion → Supabase スキーマ同期（DDL生成ツール）
 *
 * Notionのプロパティ変更をSupabaseに反映するためのDDLを生成
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read sync_schema.ts
 *   deno run --allow-env --allow-net --allow-read sync_schema.ts --table GCAL_MAPPING
 *   deno run --allow-env --allow-net --allow-read sync_schema.ts --output schema.sql
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import postgres from "npm:postgres@3";
import * as log from "../../utils/log.ts";
import { fetchEnabledConfigs, fetchConfigByName } from "./fetch_config.ts";
import { fetchDatabaseSchema } from "./fetch_data.ts";
import {
  generateCreateTableDDL,
  generateAlterTableDDL,
  extractColumnDefinitions,
} from "./type_mapping.ts";
import type {
  SyncConfig,
  SchemaComparison,
  SchemaGenerationResult,
} from "./types.ts";

// =============================================================================
// Helper Functions
// =============================================================================

function printUsage(): void {
  console.log(`
Notion Schema Sync (DDL Generator)

Usage:
  deno run --allow-env --allow-net --allow-read sync_schema.ts [options]

Options:
  -h, --help       Show this help
  -t, --table      Generate DDL for specific table only (by name)
  -o, --output     Output DDL to file instead of stdout

Examples:
  # Generate DDL for all enabled tables
  deno run --allow-env --allow-net --allow-read sync_schema.ts

  # Generate DDL for specific table
  deno run --allow-env --allow-net --allow-read sync_schema.ts --table SAUNA

  # Save DDL to file
  deno run --allow-env --allow-net --allow-read sync_schema.ts --output schema.sql
`);
}

/**
 * Supabaseテーブルのカラム情報を取得
 */
async function getSupabaseColumns(
  schema: string,
  table: string
): Promise<string[] | null> {
  let sql: postgres.Sql | null = null;

  try {
    sql = getPostgresConnection();

    // information_schemaから直接クエリ
    const result = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name = ${table}
      ORDER BY ordinal_position
    `;

    if (result.length === 0) {
      return null;
    }

    return result.map((row: { column_name: string }) => row.column_name);
  } catch (err) {
    // テーブルが存在しない場合はnullを返す
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("does not exist") || errorMsg.includes("relation") && errorMsg.includes("does not exist")) {
      return null;
    }
    throw err;
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}

/**
 * 単一テーブルのスキーマを比較してDDLを生成
 */
async function compareTableSchema(config: SyncConfig): Promise<SchemaComparison> {
  log.info(`Comparing schema for "${config.name}"...`);

  // 1. Notionプロパティを取得
  const notionProperties = await fetchDatabaseSchema(config.databaseId);
  const notionColumns = extractColumnDefinitions(notionProperties);
  const notionColumnNames = new Set(notionColumns.map((c) => c.name));

  // 共通カラムを追加
  notionColumnNames.add("id");
  notionColumnNames.add("created_at");
  notionColumnNames.add("updated_at");
  notionColumnNames.add("synced_at");

  // 2. Supabaseカラムを取得
  const supabaseColumns = await getSupabaseColumns(
    config.supabaseSchema,
    config.supabaseTable
  );

  const ddl: string[] = [];

  // 3. テーブルが存在しない場合 → CREATE TABLE
  if (supabaseColumns === null) {
    log.info(`  Table does not exist - generating CREATE TABLE`);
    ddl.push(generateCreateTableDDL(config, notionProperties));

    return {
      tableName: `${config.supabaseSchema}.${config.supabaseTable}`,
      exists: false,
      addedColumns: [...notionColumnNames],
      removedColumns: [],
      ddl,
    };
  }

  // 4. テーブルが存在する場合 → 差分を検出
  const supabaseColumnSet = new Set(supabaseColumns);

  // 追加されたカラム（Notionにあって、Supabaseにない）
  const addedColumns: Array<{ name: string; type: string }> = [];
  for (const col of notionColumns) {
    if (!supabaseColumnSet.has(col.name)) {
      addedColumns.push({ name: col.name, type: col.notionType });
    }
  }

  // 削除されたカラム（Supabaseにあって、Notionにない）
  const reservedColumns = new Set(["id", "created_at", "updated_at", "synced_at"]);
  const removedColumns: string[] = [];
  for (const col of supabaseColumns) {
    if (!notionColumnNames.has(col) && !reservedColumns.has(col)) {
      removedColumns.push(col);
    }
  }

  // DDL生成
  if (addedColumns.length > 0 || removedColumns.length > 0) {
    const alterDdls = generateAlterTableDDL(config, addedColumns, removedColumns);
    ddl.push(...alterDdls);
  }

  log.info(`  Added columns: ${addedColumns.length}`);
  log.info(`  Removed columns: ${removedColumns.length}`);

  return {
    tableName: `${config.supabaseSchema}.${config.supabaseTable}`,
    exists: true,
    addedColumns: addedColumns.map((c) => c.name),
    removedColumns,
    ddl,
  };
}

// =============================================================================
// DDL Execution
// =============================================================================

/**
 * PostgreSQL接続を取得
 */
function getPostgresConnection(): ReturnType<typeof postgres> {
  // 直接指定されている場合はそれを使用
  let dbUrl = Deno.env.get("SUPABASE_DB_URL")?.trim();

  // SUPABASE_DB_URLがない場合は自動構築
  if (!dbUrl) {
    // プロジェクトIDの取得（複数のソースから試行）
    let projectId = Deno.env.get("SUPABASE_PROJECT_ID")?.trim();
    
    // SUPABASE_URLからプロジェクトIDを抽出
    if (!projectId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
      if (supabaseUrl) {
        // https://xxxxx.supabase.co から xxxxx を抽出
        const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
        if (match) {
          projectId = match[1];
          log.info(`Extracted project ID from SUPABASE_URL: ${projectId}`);
        }
      }
    }

    // パスワードの取得（複数のソースから試行）
    const password = Deno.env.get("SUPABASE_DB_PASSWORD")?.trim() ||
                     Deno.env.get("DB_PASSWORD")?.trim();

    if (!projectId || !password) {
      throw new Error(
        "Database connection configuration missing.\n" +
        "Please set one of the following:\n" +
        "  Option 1: SUPABASE_DB_URL (full connection string)\n" +
        "  Option 2: SUPABASE_URL + SUPABASE_DB_PASSWORD (auto-constructed)\n" +
        "  Option 3: SUPABASE_PROJECT_ID + DB_PASSWORD (auto-constructed)\n\n" +
        "Example:\n" +
        "  SUPABASE_URL=\"https://xxxxx.supabase.co\"\n" +
        "  SUPABASE_DB_PASSWORD=\"xxxxx\"\n" +
        "  SUPABASE_REGION=\"aws-1-ap-northeast-1\" (optional, default: aws-1-ap-northeast-1)"
      );
    }

    const region = Deno.env.get("SUPABASE_REGION")?.trim() || "aws-1-ap-northeast-1";

    // Connection Pooler URI を構築
    dbUrl = `postgresql://postgres.${projectId}:${password}@${region}.pooler.supabase.com:5432/postgres`;
    log.info(`Using auto-constructed DB URL (region: ${region})`);
  }

  return postgres(dbUrl);
}

/**
 * DDLを実行
 */
async function executeDDL(sql: postgres.Sql, ddl: string): Promise<void> {
  try {
    await sql.unsafe(ddl);
  } catch (err) {
    throw new Error(
      `DDL execution failed: ${err instanceof Error ? err.message : err}\nSQL: ${ddl}`
    );
  }
}

/**
 * スキーマ同期を実行（テーブル作成・カラム追加）
 * 
 * @param tableName 特定テーブルのみ同期する場合はテーブル名を指定
 * @param dryRun trueの場合、DDLを生成するが実行しない
 * @returns 実行されたDDLのリスト
 */
export async function executeSchemaSync(
  tableName?: string,
  dryRun: boolean = false
): Promise<string[]> {
  const result = await generateSchemaDDL(tableName);

  if (result.allDDL.length === 0) {
    log.info("No schema changes detected");
    return [];
  }

  const executedDDL: string[] = [];

  if (!dryRun) {
    log.section("Executing Schema Changes");

    let sql: postgres.Sql | null = null;
    try {
      sql = getPostgresConnection();

      for (const ddl of result.allDDL) {
        if (!ddl || ddl.startsWith("--") || ddl.trim() === "") continue;

        log.info(`Executing: ${ddl.substring(0, 60)}...`);
        await executeDDL(sql, ddl);
        executedDDL.push(ddl);
      }

      log.success(`Executed ${executedDDL.length} DDL statements`);
    } finally {
      if (sql) {
        await sql.end();
      }
    }
  } else {
    log.info("Dry run mode - DDL not executed");
    executedDDL.push(...result.allDDL);
  }

  return executedDDL;
}

// =============================================================================
// Schema Generation
// =============================================================================

/**
 * 全テーブルのスキーマを比較してDDLを生成
 */
export async function generateSchemaDDL(tableName?: string): Promise<SchemaGenerationResult> {
  let configs: SyncConfig[];

  if (tableName) {
    const config = await fetchConfigByName(tableName);
    if (!config) {
      throw new Error(`Config not found: ${tableName}`);
    }
    configs = [config];
  } else {
    configs = await fetchEnabledConfigs();
  }

  if (configs.length === 0) {
    log.warn("No configs to process");
    return { comparisons: [], allDDL: [] };
  }

  const comparisons: SchemaComparison[] = [];
  const allDDL: string[] = [];

  // スキーマ作成DDL（最初に追加）
  allDDL.push("-- Ensure schema exists");
  const schemas = new Set(configs.map((c) => c.supabaseSchema));
  for (const schema of schemas) {
    allDDL.push(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
  }
  allDDL.push("");

  for (const config of configs) {
    const comparison = await compareTableSchema(config);
    comparisons.push(comparison);

    if (comparison.ddl.length > 0) {
      allDDL.push(`-- ${comparison.tableName}`);
      allDDL.push(...comparison.ddl);
      allDDL.push("");
    }
  }

  return { comparisons, allDDL };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    alias: {
      h: "help",
      t: "table",
      o: "output",
    },
    boolean: ["help"],
    string: ["table", "output"],
  });

  if (args.help) {
    printUsage();
    Deno.exit(0);
  }

  log.header("Notion Schema Sync");

  try {
    const result = await generateSchemaDDL(args.table);

    if (result.allDDL.length === 0) {
      log.info("No schema changes detected");
      log.footer(true);
      Deno.exit(0);
    }

    // 結果サマリー
    log.section("Schema Comparison Results");
    for (const comp of result.comparisons) {
      const status = comp.exists ? "EXISTS" : "NEW";
      log.info(`${comp.tableName} [${status}]`);
      if (comp.addedColumns.length > 0) {
        log.info(`  + Added: ${comp.addedColumns.join(", ")}`);
      }
      if (comp.removedColumns.length > 0) {
        log.warn(`  - Removed (manual review): ${comp.removedColumns.join(", ")}`);
      }
    }

    // DDL出力
    log.section("Generated DDL");
    const ddlOutput = result.allDDL.join("\n");

    if (args.output) {
      await Deno.writeTextFile(args.output, ddlOutput);
      log.success(`DDL written to ${args.output}`);
    } else {
      console.log("\n" + ddlOutput);
    }

    log.footer(true);
    log.info("Review the DDL above and apply manually via Supabase Dashboard or migration.");

  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    log.footer(false);
    Deno.exit(1);
  }
}
