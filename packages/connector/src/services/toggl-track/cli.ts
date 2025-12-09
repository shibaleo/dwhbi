#!/usr/bin/env npx tsx
/**
 * Toggl Track CLI
 *
 * Usage:
 *   npx tsx src/services/toggl-track/cli.ts [--days N]
 */

import { syncAll } from "./orchestrator.js";

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  let days = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days) || days < 1) {
        console.error("Invalid --days value");
        process.exit(1);
      }
    }
  }

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
