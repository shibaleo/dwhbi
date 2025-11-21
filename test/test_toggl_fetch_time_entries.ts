// test_fetch_time_entries.ts - fetch_time_entries.tsのテストスクリプト

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import {
  fetchRecentTimeEntries,
  fetchRecentTimeEntriesWithRetry,
  fetchTimeEntries,
} from "../src/services/toggl/fetch_time_entries.ts";
import { TogglApiV9TimeEntry } from "../src/services/toggl/types.ts";

// --- Color codes for terminal output ---
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  log(title, colors.cyan);
  console.log("=".repeat(60));
}

function logSuccess(message: string) {
  log(`✓ ${message}`, colors.green);
}

function logError(message: string) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`ℹ ${message}`, colors.blue);
}

/**
 * Display statistics for fetched time entries
 */
function displayStatistics(entries: TogglApiV9TimeEntry[]) {
  if (entries.length === 0) {
    logInfo("No entries found");
    return;
  }

  const totalDuration = entries.reduce((sum, entry) => {
    return sum + (entry.duration > 0 ? entry.duration : 0);
  }, 0);

  const projectCounts = entries.reduce((acc, entry) => {
    const projectId = entry.project_id || "No Project";
    acc[projectId] = (acc[projectId] || 0) + 1;
    return acc;
  }, {} as Record<string | number, number>);

  const billableCount = entries.filter(e => e.billable).length;
  const withDescription = entries.filter(e => e.description && e.description.trim()).length;
  const withTags = entries.filter(e => e.tags && e.tags.length > 0).length;

  console.log("\n--- Statistics ---");
  logInfo(`Total entries: ${entries.length}`);
  logInfo(`Total duration: ${(totalDuration / 3600).toFixed(2)} hours`);
  logInfo(`Billable entries: ${billableCount} (${((billableCount / entries.length) * 100).toFixed(1)}%)`);
  logInfo(`With description: ${withDescription} (${((withDescription / entries.length) * 100).toFixed(1)}%)`);
  logInfo(`With tags: ${withTags} (${((withTags / entries.length) * 100).toFixed(1)}%)`);
  
  console.log("\n--- Project Distribution ---");
  Object.entries(projectCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([projectId, count]) => {
      logInfo(`  ${projectId}: ${count} entries`);
    });
}

/**
 * Display sample entries
 */
function displaySampleEntries(entries: TogglApiV9TimeEntry[], count: number = 3) {
  const samplesToShow = Math.min(count, entries.length);
  
  console.log(`\n--- Sample Entries (showing ${samplesToShow} of ${entries.length}) ---`);
  
  for (let i = 0; i < samplesToShow; i++) {
    const entry = entries[i];
    console.log(`\n[${i + 1}] Entry ID: ${entry.id}`);
    console.log(`    Description: ${entry.description || "(no description)"}`);
    console.log(`    Project ID: ${entry.project_id || "(no project)"}`);
    console.log(`    Start: ${entry.start}`);
    console.log(`    Stop: ${entry.stop || "(running)"}`);
    console.log(`    Duration: ${entry.duration > 0 ? (entry.duration / 3600).toFixed(2) + " hours" : "running"}`);
    console.log(`    Billable: ${entry.billable ? "Yes" : "No"}`);
    console.log(`    Tags: ${entry.tags?.join(", ") || "(no tags)"}`);
  }
}

/**
 * Test 1: Fetch recent entries (2 days)
 */
async function test1_fetchRecent2Days() {
  logSection("Test 1: Fetch Recent 2 Days");
  
  try {
    const entries = await fetchRecentTimeEntries(2);
    logSuccess(`Successfully fetched ${entries.length} entries`);
    displayStatistics(entries);
    displaySampleEntries(entries);
    return true;
  } catch (error) {
    logError(`Failed: ${error}`);
    return false;
  }
}

/**
 * Test 2: Fetch recent entries with retry
 */
async function test2_fetchRecentWithRetry() {
  logSection("Test 2: Fetch Recent Entries with Retry");
  
  try {
    const entries = await fetchRecentTimeEntriesWithRetry(2, 3, 1000);
    logSuccess(`Successfully fetched ${entries.length} entries with retry logic`);
    return true;
  } catch (error) {
    logError(`Failed: ${error}`);
    return false;
  }
}

/**
 * Test 3: Fetch different time ranges
 */
async function test3_fetchDifferentRanges() {
  logSection("Test 3: Fetch Different Time Ranges");
  
  const testCases = [1, 3, 7];
  
  for (const days of testCases) {
    try {
      const entries = await fetchRecentTimeEntries(days);
      logSuccess(`Last ${days} day(s): ${entries.length} entries`);
    } catch (error) {
      logError(`Failed for ${days} days: ${error}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Test 4: Fetch specific date range
 */
async function test4_fetchSpecificDateRange() {
  logSection("Test 4: Fetch Specific Date Range");
  
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const formatDate = (date: Date) => date.toISOString().split('T')[0];
  
  const startDate = formatDate(yesterday);
  const endDate = formatDate(today);
  
  try {
    logInfo(`Fetching entries from ${startDate} to ${endDate}`);
    const entries = await fetchTimeEntries(startDate, endDate);
    logSuccess(`Successfully fetched ${entries.length} entries`);
    return true;
  } catch (error) {
    logError(`Failed: ${error}`);
    return false;
  }
}

/**
 * Test 5: Validate entry structure
 */
async function test5_validateEntryStructure() {
  logSection("Test 5: Validate Entry Structure");
  
  try {
    const entries = await fetchRecentTimeEntries(1);
    
    if (entries.length === 0) {
      logInfo("No entries to validate");
      return true;
    }
    
    const entry = entries[0];
    const requiredFields = ['id', 'workspace_id', 'start', 'duration', 'at', 'user_id'];
    
    let allFieldsPresent = true;
    for (const field of requiredFields) {
      if (!(field in entry)) {
        logError(`Missing required field: ${field}`);
        allFieldsPresent = false;
      }
    }
    
    if (allFieldsPresent) {
      logSuccess("All required fields present in entry structure");
      console.log("\nEntry structure:");
      console.log(JSON.stringify(entry, null, 2));
    }
    
    return allFieldsPresent;
  } catch (error) {
    logError(`Failed: ${error}`);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log("\n");
  log("╔═══════════════════════════════════════════════════════════╗", colors.cyan);
  log("║        Toggl Time Entries Fetch - Test Suite             ║", colors.cyan);
  log("╚═══════════════════════════════════════════════════════════╝", colors.cyan);
  
  const results = {
    passed: 0,
    failed: 0,
    total: 0,
  };
  
  const tests = [
    { name: "Fetch Recent 2 Days", fn: test1_fetchRecent2Days },
    { name: "Fetch with Retry", fn: test2_fetchRecentWithRetry },
    { name: "Different Time Ranges", fn: test3_fetchDifferentRanges },
    { name: "Specific Date Range", fn: test4_fetchSpecificDateRange },
    { name: "Validate Entry Structure", fn: test5_validateEntryStructure },
  ];
  
  for (const test of tests) {
    results.total++;
    const success = await test.fn();
    
    if (success) {
      results.passed++;
    } else {
      results.failed++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  logSection("Test Summary");
  console.log(`Total: ${results.total}`);
  logSuccess(`Passed: ${results.passed}`);
  if (results.failed > 0) {
    logError(`Failed: ${results.failed}`);
  }
  
  const successRate = ((results.passed / results.total) * 100).toFixed(1);
  console.log(`\nSuccess Rate: ${successRate}%`);
  
  if (results.failed === 0) {
    log("\n🎉 All tests passed!", colors.green);
  } else {
    log("\n⚠️  Some tests failed", colors.yellow);
  }
  
  return results.failed === 0;
}

// --- Main execution ---
if (import.meta.main) {
  try {
    const allPassed = await runAllTests();
    Deno.exit(allPassed ? 0 : 1);
  } catch (error) {
    logError(`\nUnexpected error: ${error}`);
    Deno.exit(1);
  }
}