#!/usr/bin/env npx tsx
/**
 * Fitbit CLI
 *
 * Usage:
 *   npx tsx src/services/fitbit/cli.ts [options]
 *
 * Options:
 *   --days <n>       Number of days to sync (default: 30)
 *   --log-level      Set log level (debug|info|warn|error)
 */

import { syncAll } from "./orchestrator.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function printUsage(): void {
  console.log("Usage: npx tsx src/services/fitbit/cli.ts [options]");
  console.log("");
  console.log("Options:");
  console.log("  --days <n>     Number of days to sync (default: 30)");
  console.log("  --log-level    Set log level (debug|info|warn|error)");
  console.log("  --help, -h     Show this help message");
}

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let logLevel: LogLevel = "info";
  let days = 30;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--days" && args[i + 1]) {
      const value = parseInt(args[i + 1], 10);
      if (isNaN(value) || value <= 0) {
        console.error("Invalid --days value. Must be a positive integer.");
        process.exit(1);
      }
      days = value;
      i++;
      continue;
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
  }

  // Set log level before any sync operations
  setLogLevel(logLevel);

  try {
    const result = await syncAll({ days });

    console.log(`[OK] Fitbit sync completed:`);
    console.log(`  Sleep: ${result.sleepCount}`);
    console.log(`  Activity: ${result.activityCount}`);
    console.log(`  Heart Rate: ${result.heartRateCount}`);
    console.log(`  HRV: ${result.hrvCount}`);
    console.log(`  SpO2: ${result.spo2Count}`);
    console.log(`  Breathing Rate: ${result.breathingRateCount}`);
    console.log(`  Cardio Score: ${result.cardioScoreCount}`);
    console.log(`  Temperature Skin: ${result.temperatureSkinCount}`);
    console.log(`  Elapsed: ${(result.elapsedMs / 1000).toFixed(2)}s`);

    process.exit(0);
  } catch (error) {
    console.error(`[ERROR] Sync failed: ${error}`);
    process.exit(1);
  }
}

main();
