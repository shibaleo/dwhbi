#!/usr/bin/env npx tsx
/**
 * Toggl Track CLI
 *
 * Usage:
 *   npx tsx src/services/toggl-track/cli.ts [--days N] [--log-level debug|info|warn|error]
 *   npx tsx src/services/toggl-track/cli.ts report [--days N] [--log-level debug|info|warn|error]
 *
 * Commands:
 *   (default)  Sync masters + time entries (Track API v9)
 *   report     Sync time entries from Reports API v3 (historical data)
 */

import { syncAll } from "./orchestrator.js";
import { syncTimeEntriesReport } from "./sync-time-entries-report.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/services/toggl-track/cli.ts [--days N] [--log-level LEVEL]
  npx tsx src/services/toggl-track/cli.ts report [--days N] [--log-level LEVEL]

Commands:
  (default)  Sync masters + time entries (Track API v9, default 3 days)
  report     Sync time entries from Reports API v3 (default 365 days)

Options:
  --days N           Number of days to sync
  --log-level LEVEL  Log level: debug, info, warn, error (default: info)
`);
}

interface ParsedArgs {
  command: "default" | "report";
  days: number;
  logLevel: LogLevel;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command: "default" | "report" = "default";
  let days = -1; // -1 means use default for command
  let logLevel: LogLevel = "info";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "report") {
      command = "report";
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days) || days < 1) {
        console.error("Invalid --days value");
        process.exit(1);
      }
      i++;
    } else if (arg === "--log-level" && args[i + 1]) {
      const level = args[i + 1] as LogLevel;
      if (!VALID_LOG_LEVELS.includes(level)) {
        console.error(`Invalid --log-level value. Must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
        process.exit(1);
      }
      logLevel = level;
      i++;
    }
  }

  // Set default days based on command
  if (days === -1) {
    days = command === "report" ? 365 : 3;
  }

  return { command, days, logLevel };
}

async function runDefaultSync(days: number): Promise<void> {
  const result = await syncAll(days);

  if (result.success) {
    console.log(`[OK] Toggl Track sync completed:`);
    console.log(`  Time entries: ${result.timeEntriesCount}`);
    console.log(`  Masters: ${JSON.stringify(result.mastersCounts)}`);
    console.log(`  Elapsed: ${result.elapsedSeconds}s`);
  } else {
    console.log(`[WARN] Toggl Track sync completed with warnings`);
  }
}

async function runReportSync(days: number): Promise<void> {
  // DB connection is managed per-chunk in syncTimeEntriesReport
  // to avoid timeout during long API calls
  const result = await syncTimeEntriesReport(days);

  console.log(`[OK] Toggl Track report sync completed:`);
  console.log(`  Time entries: ${result.count}`);
  console.log(`  Elapsed: ${result.elapsedSeconds}s`);
}

async function main(): Promise<void> {
  const { command, days, logLevel } = parseArgs();

  // Set log level before any sync operations
  setLogLevel(logLevel);

  try {
    if (command === "report") {
      await runReportSync(days);
    } else {
      await runDefaultSync(days);
    }
    process.exit(0);
  } catch (error) {
    console.error(`[ERROR] Toggl Track sync failed: ${error}`);
    process.exit(1);
  }
}

main();
