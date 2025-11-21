// fetch_ags.ts - Toggl API v9からタグ情報を取得

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { TogglApiV9Tag } from "./types.ts";
import { isNonRetryableError, formatTogglError } from "./retry_helper.ts";

// --- Environment variables ---
const API_TOKEN = Deno.env.get("TOGGL_API_TOKEN")?.trim();
const WORKSPACE_ID = Deno.env.get("TOGGL_WORKSPACE_ID")?.trim();

if (!API_TOKEN || !WORKSPACE_ID) {
  throw new Error("TOGGL_API_TOKEN or WORKSPACE_ID is not set in .env");
}

// --- Authentication header ---
const authHeader = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${API_TOKEN}:api_token`)}`,
};

// --- Rate limiting utility ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all tags from Toggl workspace
 * @returns Array of tags
 */
export async function fetchTags(): Promise<TogglApiV9Tag[]> {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/tags`;
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch tags: ${res.status} ${res.statusText}\n${text}`);
  }
  
  const tags: TogglApiV9Tag[] = await res.json();
  return tags;
}

/**
 * Fetch tags with retry logic
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelay Delay between retries in milliseconds
 * @returns Array of tags
 */
export async function fetchTagsWithRetry(
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<TogglApiV9Tag[]> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchTags();
    } catch (error) {
      lastError = error as Error;
      
      // レート制限エラーや認証エラーは即座に諦める
      if (isNonRetryableError(lastError)) {
        throw new Error(formatTogglError(lastError, "tags fetch"));
      }
      
      if (attempt < maxRetries) {
        await delay(retryDelay);
      }
    }
  }
  
  throw new Error(`Failed to fetch tags after ${maxRetries} attempts: ${lastError?.message}`);
}

// --- Main execution (for testing) ---
if (import.meta.main) {
  try {
    console.log("Fetching tags from Toggl workspace...");
    const tags = await fetchTagsWithRetry();
    console.log(`\nFetched ${tags.length} tags`);
    
    if (tags.length > 0) {
      console.log("\nAll tags:");
      tags.forEach(tag => {
        console.log(`  [${tag.id}] ${tag.name}`);
      });
      
      console.log("\nSample tag (full details):");
      console.log(JSON.stringify(tags[0], null, 2));
    }
  } catch (error) {
    console.error("Error:", error);
    Deno.exit(1);
  }
}