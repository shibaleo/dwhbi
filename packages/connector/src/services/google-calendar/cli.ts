#!/usr/bin/env npx tsx
/**
 * Google Calendar CLI
 *
 * Usage:
 *   npx tsx src/services/google-calendar/cli.ts [--days N] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--log-level debug|info|warn|error]
 */

import { syncAll } from "./orchestrator.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let days = 3;
  let startDate: string | undefined;
  let endDate: string | undefined;
  let logLevel: LogLevel = "info";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days) || days < 1) {
        console.error("Invalid --days value");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--start" && args[i + 1]) {
      startDate = args[i + 1];
      if (!isValidDate(startDate)) {
        console.error("Invalid --start value. Use YYYY-MM-DD format.");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--end" && args[i + 1]) {
      endDate = args[i + 1];
      if (!isValidDate(endDate)) {
        console.error("Invalid --end value. Use YYYY-MM-DD format.");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--log-level" && args[i + 1]) {
      const level = args[i + 1] as LogLevel;
      if (!VALID_LOG_LEVELS.includes(level)) {
        console.error(`Invalid --log-level value. Must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
        process.exit(1);
      }
      logLevel = level;
      i++;
    }
  }

  // Set log level before any sync operations
  setLogLevel(logLevel);

  try {
    const result = await syncAll({ days, startDate, endDate });

    if (result.success) {
      console.log(`[OK] Google Calendar sync completed:`);
      console.log(`  Events: ${result.eventsCount}`);
      console.log(`  Masters: ${JSON.stringify(result.mastersCounts)}`);
      console.log(`  Elapsed: ${result.elapsedSeconds}s`);
      process.exit(0);
    } else {
      console.log(`[WARN] Google Calendar sync completed with warnings`);
      process.exit(0);
    }
  } catch (error) {
    console.error(`[ERROR] Google Calendar sync failed: ${error}`);
    process.exit(1);
  }
}

main();
