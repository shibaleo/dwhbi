/**
 * Coda API Client
 *
 * Coda API v1 authentication and HTTP requests.
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

const logger = setupLogger("coda-api");

// Configuration
const CODA_API_BASE = "https://coda.io/apis/v1";
const DEFAULT_RETRY_DELAY_SEC = 1;

// Types
export interface AuthInfo {
  headers: Record<string, string>;
  docIds: string[];
}

export interface CodaRow {
  id: string;
  type: string;
  href: string;
  name: string;
  index: number;
  createdAt: string;
  updatedAt: string;
  browserLink: string;
  values: Record<string, unknown>;
}

export interface CodaRowsResponse {
  items: CodaRow[];
  href: string;
  nextPageToken?: string;
  nextPageLink?: string;
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
  const result = await getCredentials("coda");
  const credentials = result.credentials as Record<string, unknown>;

  const apiToken = credentials.api_token as string | undefined;
  if (!apiToken) {
    throw new Error("Coda credentials missing api_token");
  }

  const docIdsStr = credentials.doc_ids as string | undefined;
  const docIds = docIdsStr
    ? docIdsStr.split("\n").map((id) => id.trim()).filter(Boolean)
    : [];

  if (docIds.length === 0) {
    throw new Error("Coda credentials missing doc_ids");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiToken}`,
  };

  logger.debug(`Auth initialized: ${docIds.length} doc(s)`);
  cachedAuth = {
    headers,
    docIds,
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
// Coda API v1 - Data fetching
// =============================================================================

/**
 * Fetch all rows from a table (with pagination)
 */
export async function fetchTableRows(
  docId: string,
  tableId: string
): Promise<CodaRow[]> {
  const auth = await getAuthInfo();
  const allRows: CodaRow[] = [];
  let pageToken: string | undefined = undefined;
  const limit = 500; // Max per page

  logger.debug(`Fetching rows from doc=${docId}, table=${tableId}`);

  while (true) {
    const params = new URLSearchParams({
      limit: String(limit),
      valueFormat: "rich",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const url = `${CODA_API_BASE}/docs/${docId}/tables/${tableId}/rows?${params}`;
    const response = await requestWithRetry("GET", url, { headers: auth.headers });
    const data = (await response.json()) as CodaRowsResponse;

    allRows.push(...data.items);
    logger.debug(`Fetched ${data.items.length} rows (total: ${allRows.length})`);

    if (!data.nextPageToken) {
      break;
    }
    pageToken = data.nextPageToken;
  }

  logger.info(`Total: ${allRows.length} rows from table ${tableId}`);
  return allRows;
}

/**
 * Fetch tables list from a doc
 */
export async function fetchTables(
  docId: string
): Promise<{ id: string; name: string }[]> {
  const auth = await getAuthInfo();
  const url = `${CODA_API_BASE}/docs/${docId}/tables`;

  logger.debug(`Fetching tables from doc=${docId}`);
  const response = await requestWithRetry("GET", url, { headers: auth.headers });
  const data = (await response.json()) as { items: { id: string; name: string }[] };

  logger.debug(`Found ${data.items.length} tables`);
  return data.items;
}
