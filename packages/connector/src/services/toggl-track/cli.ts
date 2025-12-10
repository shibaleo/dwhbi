#!/usr/bin/env npx tsx
/**
 * Toggl Track CLI
 *
 * Usage:
 *   npx tsx src/services/toggl-track/cli.ts [--days N] [--log-level debug|info|warn|error]
 */

import { syncAll } from "./orchestrator.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let days = 3;
  let logLevel: LogLevel = "info";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days) || days < 1) {
        console.error("Invalid --days value");
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
    const result = await syncAll(days);

    if (result.success) {
      console.log(`[OK] Toggl Track sync completed:`);
      console.log(`  Time entries: ${result.timeEntriesCount}`);
      console.log(`  Masters: ${JSON.stringify(result.mastersCounts)}`);
      console.log(`  Elapsed: ${result.elapsedSeconds}s`);
      process.exit(0);
    } else {
      console.log(`[WARN] Toggl Track sync completed with warnings`);
      process.exit(0);
    }
  } catch (error) {
    console.error(`[ERROR] Toggl Track sync failed: ${error}`);
    process.exit(1);
  }
}

main();
