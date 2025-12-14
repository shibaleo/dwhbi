#!/usr/bin/env npx tsx
/**
 * Coda CLI
 *
 * Usage:
 *   npx tsx src/services/coda/cli.ts [command] [--log-level debug|info|warn|error]
 *
 * Commands:
 *   sync          Sync Coda tables to database (default)
 *   sync-toggl    Sync Toggl projects to Coda mst_toggl_projects
 *   sync-masters  Sync Coda master/mapping tables to raw schema
 */

import { syncAll, syncFromToggl, syncMastersToDb } from "./orchestrator.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const VALID_COMMANDS = ["sync", "sync-toggl", "sync-masters"] as const;
type Command = (typeof VALID_COMMANDS)[number];

function printUsage(): void {
  console.log("Usage: npx tsx src/services/coda/cli.ts [command] [options]");
  console.log("");
  console.log("Commands:");
  console.log("  sync          Sync Coda tables to database (default)");
  console.log("  sync-toggl    Sync Toggl projects to Coda mst_toggl_projects");
  console.log("  sync-masters  Sync Coda master/mapping tables to raw schema");
  console.log("");
  console.log("Options:");
  console.log("  --log-level   Set log level (debug|info|warn|error)");
}

async function runSync(): Promise<void> {
  const result = await syncAll();

  if (result.success) {
    console.log(`[OK] Coda sync completed:`);
    console.log(`  Total rows: ${result.totalRows}`);
    console.log(`  Elapsed: ${result.elapsedSeconds}s`);
    process.exit(0);
  } else {
    console.log(`[WARN] Coda sync completed with warnings`);
    result.tableResults
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`  Failed: ${r.table} - ${r.error}`);
      });
    process.exit(0);
  }
}

async function runSyncToggl(): Promise<void> {
  const result = await syncFromToggl();

  if (result.success) {
    console.log(`[OK] Toggl sync to Coda completed:`);
    console.log(`  Projects upserted: ${result.togglProjects.upserted}`);
    console.log(`  Projects deleted: ${result.togglProjects.deleted}`);
    console.log(`  Elapsed: ${result.elapsedSeconds}s`);
    process.exit(0);
  } else {
    console.log(`[ERROR] Toggl sync to Coda failed`);
    process.exit(1);
  }
}

async function runSyncMasters(): Promise<void> {
  const result = await syncMastersToDb();

  if (result.success) {
    console.log(`[OK] Coda masters sync to DB completed:`);
    console.log(`  Total rows: ${result.totalRows}`);
    for (const table of result.tables) {
      console.log(`  ${table.rawTable}: ${table.total} rows`);
    }
    console.log(`  Elapsed: ${result.elapsedSeconds}s`);
    process.exit(0);
  } else {
    console.log(`[WARN] Coda masters sync completed with errors:`);
    result.tables
      .filter((t) => !t.success)
      .forEach((t) => {
        console.log(`  Failed: ${t.rawTable} - ${t.error}`);
      });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let logLevel: LogLevel = "info";
  let command: Command = "sync";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--log-level" && args[i + 1]) {
      const level = args[i + 1] as LogLevel;
      if (!VALID_LOG_LEVELS.includes(level)) {
        console.error(
          `Invalid --log-level value. Must be one of: ${VALID_LOG_LEVELS.join(", ")}`
        );
        process.exit(1);
      }
      logLevel = level;
      i++;
      continue;
    }

    // Check if it's a command
    if (VALID_COMMANDS.includes(arg as Command)) {
      command = arg as Command;
    }
  }

  // Set log level before any sync operations
  setLogLevel(logLevel);

  try {
    switch (command) {
      case "sync":
        await runSync();
        break;
      case "sync-toggl":
        await runSyncToggl();
        break;
      case "sync-masters":
        await runSyncMasters();
        break;
    }
  } catch (error) {
    console.error(`[ERROR] Command failed: ${error}`);
    process.exit(1);
  }
}

main();
