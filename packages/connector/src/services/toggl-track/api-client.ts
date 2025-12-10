/**
 * Toggl Track API Client
 *
 * Track API v9 and Reports API v3 authentication and HTTP requests.
 * Data fetching only, no DB operations.
 *
 * Rate limit handling:
 * - 429: Wait for Retry-After header then retry
 * - Default: 1 second wait
 */

import { config } from "dotenv";
import { getCredentials } from "../../lib/credentials-vault.js";
import { setupLogger } from "../../lib/logger.js";

// Load .env for local development
config();

const logger = setupLogger("toggl-api");

// Configuration
const TRACK_API_BASE = "https://api.track.toggl.com/api/v9";
const REPORTS_API_BASE = "https://api.track.toggl.com/reports/api/v3";
const DEFAULT_RETRY_DELAY_SEC = 1;

// Types
export interface AuthInfo {
  headers: Record<string, string>;
  workspaceId: number;
}

// Authentication Cache
let cachedAuth: AuthInfo | null = null;

/**
 * Handle rate limit response
 */
async function handleRateLimit(response: Response): Promise<number> {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }
  }

  const resetTime = response.headers.get("X-RateLimit-Reset");
  if (resetTime) {
    const resetTs = parseInt(resetTime, 10);
    if (!isNaN(resetTs)) {
      const waitSeconds = resetTs - Math.floor(Date.now() / 1000);
      if (waitSeconds > 0) {
        return waitSeconds;
      }
    }
  }

  return DEFAULT_RETRY_DELAY_SEC;
}

/**
 * HTTP request with retry for rate limits
 */
async function requestWithRetry(
  method: string,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let serverErrorRetried = false;

  while (true) {
    const response = await fetch(url, { method, ...options });

    // Success
    if (response.status < 400) {
      return response;
    }

    // Rate limit (429)
    if (response.status === 429) {
      const waitSeconds = await handleRateLimit(response);
      logger.warn(`Rate limited (429). Waiting ${waitSeconds}s...`);
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      continue;
    }

    // Server error (5xx) - retry once
    if (response.status >= 500 && response.status < 600) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        logger.warn(`Server error (${response.status}). Retrying once...`);
        await new Promise((r) => setTimeout(r, DEFAULT_RETRY_DELAY_SEC * 1000));
        continue;
      }
      logger.error(`Server error (${response.status}) after retry.`);
    }

    // Other errors
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

/**
 * Get authentication info (cached)
 */
export async function getAuthInfo(): Promise<AuthInfo> {
  if (cachedAuth !== null) {
    logger.debug("Using cached auth info");
    return cachedAuth;
  }

  logger.debug("Loading credentials from vault...");
  const result = await getCredentials("toggl_track");
  const credentials = result.credentials as Record<string, unknown>;

  const apiToken = credentials.api_token as string | undefined;
  if (!apiToken) {
    throw new Error("Toggl credentials missing api_token");
  }

  // Basic auth: api_token:api_token base64 encoded
  const authString = `${apiToken}:api_token`;
  const encoded = Buffer.from(authString).toString("base64");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${encoded}`,
  };
  logger.debug("Basic auth header generated");

  // Get workspace_id
  let workspaceId = credentials.workspace_id as number | undefined;
  if (!workspaceId) {
    logger.debug("workspace_id not in credentials, fetching from /me...");
    const meResponse = await fetch(`${TRACK_API_BASE}/me`, { headers });
    if (!meResponse.ok) {
      throw new Error(`Failed to get /me: ${meResponse.status}`);
    }
    const meData = (await meResponse.json()) as { default_workspace_id?: number };
    workspaceId = meData.default_workspace_id;
  }

  if (!workspaceId) {
    throw new Error("Failed to get workspace_id from Toggl");
  }

  logger.debug(`Auth initialized: workspace_id=${workspaceId}`);
  cachedAuth = {
    headers,
    workspaceId,
  };
  return cachedAuth;
}

/**
 * Reset cache (for testing)
 */
export function resetCache(): void {
  cachedAuth = null;
}

// =============================================================================
// Track API v9 - Data fetching
// =============================================================================

/**
 * Fetch time entries
 */
export async function fetchTimeEntries(
  startDate: string,
  endDate: string
): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const url = `${TRACK_API_BASE}/me/time_entries?${params}`;

  logger.debug(`GET /me/time_entries (${startDate} to ${endDate})`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const entries = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${entries.length} entries`);
  return entries;
}

/**
 * Fetch projects
 */
export async function fetchProjects(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/workspaces/${auth.workspaceId}/projects`;

  logger.debug(`GET /workspaces/${auth.workspaceId}/projects`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const items = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${items.length} projects`);
  return items;
}

/**
 * Fetch clients
 */
export async function fetchClients(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/workspaces/${auth.workspaceId}/clients`;

  logger.debug(`GET /workspaces/${auth.workspaceId}/clients`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const items = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${items.length} clients`);
  return items;
}

/**
 * Fetch tags
 */
export async function fetchTags(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/workspaces/${auth.workspaceId}/tags`;

  logger.debug(`GET /workspaces/${auth.workspaceId}/tags`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const items = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${items.length} tags`);
  return items;
}

/**
 * Fetch current user info
 */
export async function fetchMe(): Promise<Record<string, unknown>> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/me`;

  logger.debug("GET /me");
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = (await response.json()) as Record<string, unknown>;
  logger.debug(`Response: user_id=${data.id}`);
  return data;
}

/**
 * Fetch workspaces
 */
export async function fetchWorkspaces(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/workspaces`;

  logger.debug("GET /workspaces");
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const items = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${items.length} workspaces`);
  return items;
}

/**
 * Fetch workspace users
 */
export async function fetchWorkspaceUsers(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/workspaces/${auth.workspaceId}/users`;

  logger.debug(`GET /workspaces/${auth.workspaceId}/users`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const items = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${items.length} users`);
  return items;
}

/**
 * Fetch workspace groups
 */
export async function fetchWorkspaceGroups(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();
  const url = `${TRACK_API_BASE}/workspaces/${auth.workspaceId}/groups`;

  logger.debug(`GET /workspaces/${auth.workspaceId}/groups`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = await response.json();
  const items = (data as Record<string, unknown>[]) || [];
  logger.debug(`Response: ${items.length} groups`);
  return items;
}

// =============================================================================
// Reports API v3 - Detailed report
// =============================================================================

/**
 * Fetch detailed report (single page)
 */
export async function fetchDetailedReport(
  startDate: string,
  endDate: string,
  firstRowNumber: number = 1,
  pageSize: number = 1000
): Promise<Record<string, unknown>> {
  const auth = await getAuthInfo();
  const url = `${REPORTS_API_BASE}/workspace/${auth.workspaceId}/search/time_entries`;

  const payload = {
    start_date: startDate,
    end_date: endDate,
    first_row_number: firstRowNumber,
    page_size: pageSize,
  };

  const response = await requestWithRetry("POST", url, {
    headers: auth.headers,
    body: JSON.stringify(payload),
  });

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Fetch all detailed report (with pagination)
 */
export async function fetchAllDetailedReport(
  startDate: string,
  endDate: string
): Promise<Record<string, unknown>[]> {
  const allEntries: Record<string, unknown>[] = [];
  let firstRow = 1;
  const pageSize = 1000;

  while (true) {
    const result = await fetchDetailedReport(startDate, endDate, firstRow, pageSize);

    let entries: Record<string, unknown>[];
    if (Array.isArray(result)) {
      entries = result;
    } else {
      entries =
        (result.time_entries as Record<string, unknown>[]) ||
        (result.data as Record<string, unknown>[]) ||
        [];
    }

    if (entries.length === 0) {
      break;
    }

    allEntries.push(...entries);
    logger.info(`Fetched ${entries.length} entries (total: ${allEntries.length})`);

    if (entries.length < pageSize) {
      break;
    }

    firstRow += pageSize;
  }

  return allEntries;
}
