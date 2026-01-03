#!/usr/bin/env npx tsx
/**
 * Fitbit CLI
 *
 * Usage:
 *   npx tsx src/services/fitbit/cli.ts [options]
 *
 * Options:
 *   --days <n>       Number of days to sync (default: 30)
 *   --from <date>    Start date (YYYY-MM-DD format)
 *   --to <date>      End date (YYYY-MM-DD format, default: today)
 *   --log-level      Set log level (debug|info|warn|error)
 *
 * Examples:
 *   npx tsx src/services/fitbit/cli.ts --days 30
 *   npx tsx src/services/fitbit/cli.ts --from 2020-06-01 --to 2025-12-31
 */

import { syncAll } from "./orchestrator.js";
import { setLogLevel, type LogLevel } from "../../lib/logger.js";

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function parseDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return date;
}

function printUsage(): void {
  console.log("Usage: npx tsx src/services/fitbit/cli.ts [options]");
  console.log("");
  console.log("Options:");
  console.log("  --days <n>             Number of days to sync (default: 30)");
  console.log("  --from <date>          Start date (YYYY-MM-DD format)");
  console.log("  --to <date>            End date (YYYY-MM-DD format, default: today)");
  console.log("  --skip-activity        Skip activity sync");
  console.log("  --only-activity        Only sync activity data");
  console.log("  --activity-timeseries  Use Time Series API for activity (~70% fewer API calls)");
  console.log("  --log-level            Set log level (debug|info|warn|error)");
  console.log("  --help, -h             Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  npx tsx src/services/fitbit/cli.ts --days 30");
  console.log("  npx tsx src/services/fitbit/cli.ts --from 2020-06-01 --to 2025-12-31");
  console.log("  npx tsx src/services/fitbit/cli.ts --from 2020-06-01 --to 2025-12-31 --skip-activity");
  console.log("  npx tsx src/services/fitbit/cli.ts --from 2020-06-01 --to 2025-12-31 --only-activity");
  console.log("  npx tsx src/services/fitbit/cli.ts --from 2020-06-01 --to 2025-12-31 --only-activity --activity-timeseries");
}

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let logLevel: LogLevel = "info";
  let days = 30;
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  let skipActivity = false;
  let onlyActivity = false;
  let useActivityTimeSeries = false;

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

    if (arg === "--from" && args[i + 1]) {
      const date = parseDate(args[i + 1]);
      if (!date) {
        console.error("Invalid --from value. Must be in YYYY-MM-DD format.");
        process.exit(1);
      }
      fromDate = date;
      i++;
      continue;
    }

    if (arg === "--to" && args[i + 1]) {
      const date = parseDate(args[i + 1]);
      if (!date) {
        console.error("Invalid --to value. Must be in YYYY-MM-DD format.");
        process.exit(1);
      }
      toDate = date;
      i++;
      continue;
    }

    if (arg === "--skip-activity") {
      skipActivity = true;
      continue;
    }

    if (arg === "--only-activity") {
      onlyActivity = true;
      continue;
    }

    if (arg === "--activity-timeseries") {
      useActivityTimeSeries = true;
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

  // Validate date range
  if (fromDate && !toDate) {
    toDate = new Date(); // Default to today
  }
  if (fromDate && toDate && fromDate > toDate) {
    console.error("Invalid date range: --from must be before --to");
    process.exit(1);
  }

  // Set log level before any sync operations
  setLogLevel(logLevel);

  // Show estimated time for large syncs
  if (fromDate && toDate) {
    const dayCount = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    const chunks30 = Math.ceil(dayCount / 30);
    let estimatedRequests: number;
    let note = "";

    if (onlyActivity && useActivityTimeSeries) {
      // Time Series: 9 resources per 30-day chunk
      estimatedRequests = chunks30 * 9;
      note = " (activity only, Time Series API)";
    } else if (onlyActivity) {
      // Daily Summary: 1 request per day
      estimatedRequests = dayCount;
      note = " (activity only, Daily Summary API)";
    } else if (skipActivity) {
      // No activity: sleep (100-day chunks) + 6 other metrics (30-day chunks)
      estimatedRequests = Math.ceil(dayCount / 100) + chunks30 * 6;
      note = " (activity skipped)";
    } else if (useActivityTimeSeries) {
      // Full sync with Time Series: sleep + activity(9 per chunk) + 6 others
      estimatedRequests = Math.ceil(dayCount / 100) + chunks30 * 9 + chunks30 * 6;
      note = " (with Time Series API for activity)";
    } else {
      // Full sync with Daily Summary: sleep + activity(1 per day) + 6 others
      estimatedRequests = Math.ceil(dayCount / 100) + dayCount + chunks30 * 6;
      note = " (with Daily Summary API for activity)";
    }

    const estimatedHours = estimatedRequests / 150; // 150 req/hour limit
    console.log(`[INFO] Estimated ${dayCount} days, ~${estimatedRequests} requests${note}`);
    console.log(`[INFO] Estimated time: ${estimatedHours.toFixed(1)} hours (without rate limit waits)`);
    console.log(`[INFO] With rate limits, expect up to ${(estimatedHours * 1.5).toFixed(1)} hours`);
    console.log("");
  }

  try {
    const result = await syncAll({
      days,
      fromDate,
      toDate,
      skipActivity,
      onlyActivity,
      useActivityTimeSeries,
    });

    console.log(`[OK] Fitbit sync completed:`);
    console.log(`  Sleep: ${result.sleepCount}`);
    console.log(`  Activity: ${result.activityCount}`);
    console.log(`  Heart Rate: ${result.heartRateCount}`);
    console.log(`  HRV: ${result.hrvCount}`);
    console.log(`  SpO2: ${result.spo2Count}`);
    console.log(`  Breathing Rate: ${result.breathingRateCount}`);
    console.log(`  Cardio Score: ${result.cardioScoreCount}`);
    console.log(`  Temperature Skin: ${result.temperatureSkinCount}`);
    console.log(`  Elapsed: ${(result.elapsedMs / 1000 / 60).toFixed(1)} minutes`);

    process.exit(0);
  } catch (error) {
    console.error(`[ERROR] Sync failed: ${error}`);
    process.exit(1);
  }
}

main();
