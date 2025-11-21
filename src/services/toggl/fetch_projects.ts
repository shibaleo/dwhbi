// fetch_rojects.ts - Toggl API v9からプロジェクト情報を取得

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { TogglApiV9Project } from "./types.ts";
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
 * Fetch all projects from Toggl workspace
 * @param includeArchived Whether to include archived projects (default: true)
 * @returns Array of projects
 */
export async function fetchProjects(includeArchived: boolean = true): Promise<TogglApiV9Project[]> {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/projects`;
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch projects: ${res.status} ${res.statusText}\n${text}`);
  }
  
  let projects: TogglApiV9Project[] = await res.json();
  
  if (!includeArchived) {
    projects = projects.filter(p => p.active !== false);
  }
  
  return projects;
}

/**
 * Fetch projects with retry logic
 * @param includeArchived Whether to include archived projects
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelay Delay between retries in milliseconds
 * @returns Array of projects
 */
export async function fetchProjectsWithRetry(
  includeArchived: boolean = true,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<TogglApiV9Project[]> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchProjects(includeArchived);
    } catch (error) {
      lastError = error as Error;
      
      // レート制限エラーや認証エラーは即座に諦める
      if (isNonRetryableError(lastError)) {
        throw new Error(formatTogglError(lastError, "projects fetch"));
      }
      
      if (attempt < maxRetries) {
        await delay(retryDelay);
      }
    }
  }
  
  throw new Error(`Failed to fetch projects after ${maxRetries} attempts: ${lastError?.message}`);
}