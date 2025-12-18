/**
 * Google Calendar Event Creation - standalone module for Next.js
 *
 * This file contains self-contained event creation functionality
 * using PostgreSQL Vault for credentials (same as api-client.ts).
 *
 * Required environment:
 * - DIRECT_DATABASE_URL: PostgreSQL connection string for vault access
 */

import { config } from "dotenv";
import postgres from "postgres";

// Load .env for local development
config();

// Configuration
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DEFAULT_THRESHOLD_MINUTES = 5;
const DEFAULT_RETRY_DELAY_SEC = 1;

// Types
export interface CreateEventInput {
  summary: string;
  description?: string;
  startDateTime: string; // ISO 8601 format with timezone (e.g., "2025-01-15T09:00:00+09:00")
  endDateTime: string; // ISO 8601 format with timezone
  colorId?: string; // Google Calendar color ID (1-11 for events)
}

export interface CreateEventResult {
  id: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface AuthInfo {
  accessToken: string;
  calendarId: string;
}

interface CredentialsResult {
  credentials: Record<string, unknown>;
  expiresAt: Date | null;
}

// Cache for auth
let cachedAuth: AuthInfo | null = null;
let cachedExpiresAt: Date | null = null;

/**
 * Get database connection
 */
function getDbConnection() {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_DATABASE_URL is not set");
  }
  return postgres(connectionString);
}

/**
 * Get credentials from vault.secrets
 */
async function getCredentials(service: string): Promise<CredentialsResult> {
  const sql = getDbConnection();

  try {
    const result = await sql`
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ${service}
    `;

    if (result.length === 0 || !result[0].decrypted_secret) {
      throw new Error(`Credentials not found for service: ${service}`);
    }

    const decrypted = result[0].decrypted_secret;
    const data = typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;

    // Extract metadata
    const expiresAtStr = data._expires_at;
    delete data._expires_at;
    delete data._auth_type;

    // Parse expires_at
    let expiresAt: Date | null = null;
    if (expiresAtStr) {
      expiresAt = new Date(expiresAtStr.replace("Z", "+00:00"));
    }

    return { credentials: data, expiresAt };
  } finally {
    await sql.end();
  }
}

/**
 * Update credentials in vault.secrets (partial update)
 */
async function updateCredentials(
  service: string,
  updates: Record<string, unknown>,
  expiresAt: Date | null = null
): Promise<void> {
  const sql = getDbConnection();

  try {
    // Get existing credentials
    const result = await sql`
      SELECT id, decrypted_secret FROM vault.decrypted_secrets WHERE name = ${service}
    `;

    if (result.length === 0) {
      throw new Error(`Credentials not found for service: ${service}`);
    }

    const secretId = result[0].id;
    const decrypted = result[0].decrypted_secret;
    const currentData = typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;

    // Preserve metadata
    const authType = currentData._auth_type || "oauth2";
    const currentExpiresAt = currentData._expires_at;

    // Merge non-metadata fields
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(currentData)) {
      if (!key.startsWith("_")) {
        merged[key] = value;
      }
    }
    Object.assign(merged, updates);

    // Add metadata back
    merged._auth_type = authType;
    merged._expires_at = expiresAt ? expiresAt.toISOString() : currentExpiresAt;

    // Update
    const secretJson = JSON.stringify(merged);
    await sql`SELECT vault.update_secret(${secretId}, ${secretJson}, ${service}, ${service + " credentials"})`;
  } finally {
    await sql.end();
  }
}

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

    if (response.status < 400) {
      return response;
    }

    if (response.status === 429) {
      const waitSeconds = await handleRateLimit(response);
      console.warn(`Rate limited (429). Waiting ${waitSeconds}s...`);
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      continue;
    }

    if (response.status >= 500 && response.status < 600) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        console.warn(`Server error (${response.status}). Retrying once...`);
        await new Promise((r) => setTimeout(r, DEFAULT_RETRY_DELAY_SEC * 1000));
        continue;
      }
    }

    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

/**
 * Fetch primary calendar ID from CalendarList
 */
async function fetchPrimaryCalendarId(accessToken: string): Promise<string> {
  const response = await fetch(
    `${CALENDAR_API_BASE}/users/me/calendarList`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to get calendarList: ${response.status}`);
  }

  const data = (await response.json()) as { items?: Array<{ id: string; primary?: boolean }> };
  for (const item of data.items || []) {
    if (item.primary) {
      console.log(`Auto-detected primary calendar: ${item.id}`);
      return item.id;
    }
  }

  throw new Error("Primary calendar not found in CalendarList");
}

/**
 * Refresh access token from Google OAuth
 */
async function refreshTokenFromApi(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh error: ${response.status} - ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Get authentication info from vault (cached with auto-refresh)
 */
async function getAuthInfo(forceRefresh: boolean = false): Promise<AuthInfo> {
  // Check cache
  if (!forceRefresh && cachedAuth !== null && cachedExpiresAt !== null) {
    const minutesUntilExpiry = (cachedExpiresAt.getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > DEFAULT_THRESHOLD_MINUTES) {
      return cachedAuth;
    }
  }

  // Load from vault
  console.log("Loading credentials from vault...");
  const result = await getCredentials("google_calendar");
  const credentials = result.credentials;
  let expiresAt = result.expiresAt;

  // Validate required fields
  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Missing client_id or client_secret in vault");
  }
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error("Missing access_token or refresh_token. Run OAuth flow first.");
  }

  // Check if refresh needed
  let needsRefresh = forceRefresh;
  if (!needsRefresh) {
    if (!expiresAt) {
      needsRefresh = true;
    } else {
      const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / 1000 / 60;
      needsRefresh = minutesUntilExpiry <= DEFAULT_THRESHOLD_MINUTES;
    }
  }

  let accessToken = credentials.access_token as string;
  let currentExpiresAt = expiresAt;

  // Refresh if needed
  if (needsRefresh) {
    console.log("Refreshing access token...");
    const newToken = await refreshTokenFromApi(
      credentials.client_id as string,
      credentials.client_secret as string,
      credentials.refresh_token as string
    );

    accessToken = newToken.access_token;
    currentExpiresAt = new Date(Date.now() + newToken.expires_in * 1000);

    // Update vault
    await updateCredentials(
      "google_calendar",
      {
        access_token: accessToken,
        scope: newToken.scope,
      },
      currentExpiresAt
    );

    console.log(`Token refreshed (expires: ${currentExpiresAt.toISOString()})`);
  }

  // Get calendar_id if not set
  let calendarId = credentials.calendar_id as string | undefined;
  if (!calendarId) {
    calendarId = await fetchPrimaryCalendarId(accessToken);
  }

  // Cache and return
  cachedAuth = { accessToken, calendarId };
  cachedExpiresAt = currentExpiresAt;

  console.log(`Auth initialized: calendar_id=${calendarId}`);
  return cachedAuth;
}

/**
 * Create a single event
 */
export async function createEvent(
  event: CreateEventInput,
  calendarId?: string
): Promise<CreateEventResult> {
  const auth = await getAuthInfo();
  const targetCalendarId = calendarId || auth.calendarId;
  const calendarIdEncoded = encodeURIComponent(targetCalendarId);

  const url = `${CALENDAR_API_BASE}/calendars/${calendarIdEncoded}/events`;

  const body: Record<string, unknown> = {
    summary: event.summary,
    start: { dateTime: event.startDateTime },
    end: { dateTime: event.endDateTime },
  };

  if (event.description) {
    body.description = event.description;
  }

  if (event.colorId) {
    body.colorId = event.colorId;
  }

  console.log(`Creating event: ${event.summary}`);

  let response: Response;
  try {
    response = await requestWithRetry("POST", url, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Token expired, refresh and retry
    if (String(error).includes("401")) {
      console.warn("Token expired, refreshing...");
      const newAuth = await getAuthInfo(true);
      response = await requestWithRetry("POST", url, {
        headers: {
          Authorization: `Bearer ${newAuth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } else {
      throw error;
    }
  }

  const data = (await response.json()) as CreateEventResult;
  console.log(`Created event: ${data.id}`);
  return data;
}

/**
 * Create multiple events in batch
 * Note: Google Calendar API doesn't support true batch creation,
 * so we create events sequentially with small delays to avoid rate limits
 */
export async function createEvents(
  events: CreateEventInput[],
  calendarId?: string
): Promise<{ created: CreateEventResult[]; failed: { event: CreateEventInput; error: string }[] }> {
  const created: CreateEventResult[] = [];
  const failed: { event: CreateEventInput; error: string }[] = [];

  console.log(`Creating ${events.length} events...`);

  for (const event of events) {
    try {
      const result = await createEvent(event, calendarId);
      created.push(result);
      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to create event "${event.summary}": ${message}`);
      failed.push({ event, error: message });
    }
  }

  console.log(`Created ${created.length}/${events.length} events`);
  if (failed.length > 0) {
    console.warn(`Failed: ${failed.length} events`);
  }

  return { created, failed };
}
