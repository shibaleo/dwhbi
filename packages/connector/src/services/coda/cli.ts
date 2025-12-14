#!/usr/bin/env npx tsx
/**
 * Coda CLI
 *
 * Usage:
 *   npx tsx src/services/coda/cli.ts [--log-level debug|info|warn|error]
 */

import { syncAll } from "./orchestrator.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let logLevel: LogLevel = "info";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--log-level" && args[i + 1]) {
      const level = args[i + 1] as LogLevel;
      if (!VALID_LOG_LEVELS.includes(level)) {
        console.error(
          `Invalid --log-level value. Must be one of: ${VALID_LOG_LEVELS.join(", ")}`
        );
        process.exit(1);
      }
      logLevel = level;
      i++;
    }
  }

  // Set log level before any sync operations
  setLogLevel(logLevel);

  try {
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
  } catch (error) {
    console.error(`[ERROR] Coda sync failed: ${error}`);
    process.exit(1);
  }
}

main();
