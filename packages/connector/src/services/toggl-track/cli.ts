#!/usr/bin/env npx tsx
/**
 * Toggl Track CLI
 *
 * Usage:
 *   npx tsx src/services/toggl-track/cli.ts [--days N] [--log-level debug|info|warn|error]
 *   npx tsx src/services/toggl-track/cli.ts report [--days N] [--start YYYY-MM-DD] [--end YYYY-MM-DD]
 *
 * Commands:
 *   (default)  Sync masters + time entries (Track API v9)
 *   report     Sync time entries from Reports API v3 (historical data)
 */

import { syncAll } from "./orchestrator.js";
import { syncTimeEntriesReport, type SyncOptions } from "./sync-time-entries-report.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/services/toggl-track/cli.ts [--days N] [--log-level LEVEL]
  npx tsx src/services/toggl-track/cli.ts report [--days N | --start DATE [--end DATE]]

Commands:
  (default)  Sync masters + time entries (Track API v9, default 3 days)
  report     Sync time entries from Reports API v3 (default 365 days)

Options:
  --days N           Number of days to sync (ignored if --start is provided)
  --start YYYY-MM-DD Start date for report sync
  --end YYYY-MM-DD   End date for report sync (default: tomorrow)
  --log-level LEVEL  Log level: debug, info, warn, error (default: info)
`);
}

interface ParsedArgs {
  command: "default" | "report";
  days: number;
  start?: string;
  end?: string;
  logLevel: LogLevel;
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let command: "default" | "report" = "default";
  let days = -1; // -1 means use default for command
  let start: string | undefined;
  let end: string | undefined;
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
    } else if (arg === "--start" && args[i + 1]) {
      start = args[i + 1];
      if (!isValidDate(start)) {
        console.error("Invalid --start value. Use YYYY-MM-DD format.");
        process.exit(1);
      }
      i++;
    } else if (arg === "--end" && args[i + 1]) {
      end = args[i + 1];
      if (!isValidDate(end)) {
        console.error("Invalid --end value. Use YYYY-MM-DD format.");
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

  // Set default days based on command (only if --start not provided)
  if (days === -1 && !start) {
    days = command === "report" ? 365 : 3;
  }

  return { command, days, start, end, logLevel };
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

async function runReportSync(options: SyncOptions): Promise<void> {
  // DB connection is managed per-chunk in syncTimeEntriesReport
  // to avoid timeout during long API calls
  const result = await syncTimeEntriesReport(options);

  console.log(`[OK] Toggl Track report sync completed:`);
  console.log(`  Time entries: ${result.count}`);
  console.log(`  Elapsed: ${result.elapsedSeconds}s`);
}

async function main(): Promise<void> {
  const { command, days, start, end, logLevel } = parseArgs();

  // Set log level before any sync operations
  setLogLevel(logLevel);

  try {
    if (command === "report") {
      await runReportSync({ days, start, end });
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
