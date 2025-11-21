// fetchTimeEntries.ts - Toggl API v9から時間エントリー情報を取得

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { TogglApiV9TimeEntry } from "./types.ts";

// --- Environment variables ---
const API_TOKEN = Deno.env.get("TOGGL_API_TOKEN")?.trim();

if (!API_TOKEN) {
  throw new Error("TOGGL_API_TOKEN is not set in .env");
}

// --- Authentication header ---
const authHeader = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${API_TOKEN}:api_token`)}`,
};

// --- Rate limiting utility ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Format date to ISO 8601 string (YYYY-MM-DD)
 * @param date Date object
 * @returns ISO date string
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get date range for the last N days
 * @param days Number of days to look back
 * @returns Object with start and end dates in ISO format
 */
function getDateRange(days: number = 2): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  
  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

/**
 * Fetch time entries for a specific date range
 * @param startDate Start date in YYYY-MM-DD format
 * @param endDate End date in YYYY-MM-DD format
 * @returns Array of time entries
 */
export async function fetchTimeEntries(
  startDate: string,
  endDate: string
): Promise<TogglApiV9TimeEntry[]> {
  const url = `https://api.track.toggl.com/api/v9/me/time_entries?start_date=${startDate}&end_date=${endDate}`;
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch time entries: ${res.status} ${res.statusText}\n${text}`);
  }
  
  const entries: TogglApiV9TimeEntry[] = await res.json();
  return entries;
}

/**
 * Fetch time entries for the last N days
 * @param days Number of days to look back (default: 2)
 * @returns Array of time entries
 */
export async function fetchRecentTimeEntries(days: number = 2): Promise<TogglApiV9TimeEntry[]> {
  const { start, end } = getDateRange(days);
  return await fetchTimeEntries(start, end);
}

/**
 * Fetch time entries with retry logic
 * @param startDate Start date in YYYY-MM-DD format
 * @param endDate End date in YYYY-MM-DD format
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelay Delay between retries in milliseconds
 * @returns Array of time entries
 */
export async function fetchTimeEntriesWithRetry(
  startDate: string,
  endDate: string,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<TogglApiV9TimeEntry[]> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchTimeEntries(startDate, endDate);
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        await delay(retryDelay);
      }
    }
  }
  
  throw new Error(`Failed to fetch time entries after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Fetch recent time entries with retry logic
 * @param days Number of days to look back
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelay Delay between retries in milliseconds
 * @returns Array of time entries
 */
export async function fetchRecentTimeEntriesWithRetry(
  days: number = 2,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<TogglApiV9TimeEntry[]> {
  const { start, end } = getDateRange(days);
  return await fetchTimeEntriesWithRetry(start, end, maxRetries, retryDelay);
}

// --- Main execution (for testing) ---
if (import.meta.main) {
  try {
    console.log("Fetching time entries for the last 2 days...");
    const entries = await fetchRecentTimeEntriesWithRetry(2);
    console.log(`\nFetched ${entries.length} time entries`);
    
    if (entries.length > 0) {
      console.log("\nSample entry:");
      console.log(JSON.stringify(entries[0], null, 2));
    }
  } catch (error) {
    console.error("Error:", error);
    Deno.exit(1);
  }
}