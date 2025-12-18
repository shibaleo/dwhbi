/**
 * Google Calendar API Client
 *
 * OAuth 2.0 authentication (refresh token) and API calls.
 * Data fetching only, no DB operations.
 *
 * Credentials:
 * - Loaded from Supabase Vault (getCredentials("google_calendar"))
 * - access_token is auto-refreshed when expired
 */

import { config } from "dotenv";
import {
  getCredentials,
  updateCredentials,
} from "../../lib/credentials-vault.js";
import { setupLogger } from "../../lib/logger.js";

// Load .env for local development
config();

const logger = setupLogger("gcal-api");

// Configuration
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DEFAULT_THRESHOLD_MINUTES = 5;
const MAX_RESULTS_PER_PAGE = 2500;
const DEFAULT_RETRY_DELAY_SEC = 1;
const JST_OFFSET = "+09:00";

// Types
export interface AuthInfo {
  accessToken: string;
  calendarId: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// Authentication Cache
let cachedAuth: AuthInfo | null = null;
let cachedExpiresAt: Date | null = null;

/**
 * Reset cache (for testing)
 */
export function resetCache(): void {
  cachedAuth = null;
  cachedExpiresAt = null;
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
      logger.warn(`Rate limited (429). Waiting ${waitSeconds}s...`);
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      continue;
    }

    if (response.status >= 500 && response.status < 600) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        logger.warn(`Server error (${response.status}). Retrying once...`);
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
      logger.info(`Auto-detected primary calendar: ${item.id}`);
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
 * Get authentication info (cached with auto-refresh)
 */
export async function getAuthInfo(forceRefresh: boolean = false): Promise<AuthInfo> {
  // Check cache
  if (!forceRefresh && cachedAuth !== null && cachedExpiresAt !== null) {
    const minutesUntilExpiry =
      (cachedExpiresAt.getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > DEFAULT_THRESHOLD_MINUTES) {
      logger.debug(`Using cached auth (${Math.round(minutesUntilExpiry)} min until expiry)`);
      return cachedAuth;
    }
  }

  // Load from vault
  logger.debug("Loading credentials from vault...");
  const result = await getCredentials("google_calendar");
  const credentials = result.credentials as Record<string, unknown>;
  let expiresAt = result.expiresAt;

  // Validate required fields
  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Missing client_id or client_secret");
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
      const minutesUntilExpiry =
        (expiresAt.getTime() - Date.now()) / 1000 / 60;
      needsRefresh = minutesUntilExpiry <= DEFAULT_THRESHOLD_MINUTES;
    }
  }

  let accessToken = credentials.access_token as string;
  let currentExpiresAt = expiresAt;

  // Refresh if needed
  if (needsRefresh) {
    logger.info("Refreshing access token...");
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

    logger.info(`Token refreshed (expires: ${currentExpiresAt.toISOString()})`);
  }

  // Get calendar_id if not set
  let calendarId = credentials.calendar_id as string | undefined;
  if (!calendarId) {
    calendarId = await fetchPrimaryCalendarId(accessToken);
  }

  // Cache and return
  cachedAuth = {
    accessToken,
    calendarId,
  };
  cachedExpiresAt = currentExpiresAt;

  logger.debug(`Auth initialized: calendar_id=${calendarId}`);
  return cachedAuth;
}

// =============================================================================
// Calendar API - Events
// =============================================================================

/**
 * Fetch events (with pagination)
 */
export async function fetchEvents(
  startDate: string,
  endDate: string
): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();

  const timeMin = `${startDate}T00:00:00${JST_OFFSET}`;
  const timeMax = `${endDate}T23:59:59${JST_OFFSET}`;

  logger.debug(`GET /calendars/{id}/events (${startDate} to ${endDate})`);

  const allEvents: Record<string, unknown>[] = [];
  let pageToken: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(MAX_RESULTS_PER_PAGE),
      singleEvents: "true",
      orderBy: "startTime",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const calendarIdEncoded = encodeURIComponent(auth.calendarId);
    const url = `${CALENDAR_API_BASE}/calendars/${calendarIdEncoded}/events?${params}`;

    let response: Response;
    try {
      response = await requestWithRetry("GET", url, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
    } catch (error) {
      // Token expired, refresh and retry
      if (String(error).includes("401")) {
        logger.warn("Token expired, refreshing...");
        const newAuth = await getAuthInfo(true);
        response = await requestWithRetry("GET", url, {
          headers: { Authorization: `Bearer ${newAuth.accessToken}` },
        });
      } else {
        throw error;
      }
    }

    const data = (await response.json()) as {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
    };

    if (data.items) {
      // Add calendar_id to each event
      for (const item of data.items) {
        item._calendar_id = auth.calendarId;
      }
      allEvents.push(...data.items);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) {
      break;
    }

    logger.debug(`Pagination: fetching next page...`);
    await new Promise((r) => setTimeout(r, 100));
  }

  logger.debug(`Response: ${allEvents.length} events total`);
  return allEvents;
}

// =============================================================================
// Calendar API - Colors
// =============================================================================

/**
 * Fetch color palette
 */
export async function fetchColors(): Promise<Record<string, unknown>> {
  const auth = await getAuthInfo();

  logger.debug("GET /colors");
  const response = await requestWithRetry("GET", `${CALENDAR_API_BASE}/colors`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  const data = (await response.json()) as Record<string, unknown>;
  logger.debug("Response: colors fetched");
  return data;
}

// =============================================================================
// Calendar API - CalendarList
// =============================================================================

/**
 * Fetch calendar list
 */
export async function fetchCalendarList(): Promise<Record<string, unknown>[]> {
  const auth = await getAuthInfo();

  logger.debug("GET /users/me/calendarList");
  const allCalendars: Record<string, unknown>[] = [];
  let pageToken: string | undefined;

  while (true) {
    const params = new URLSearchParams({ maxResults: "250" });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const url = `${CALENDAR_API_BASE}/users/me/calendarList?${params}`;
    const response = await requestWithRetry("GET", url, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });

    const data = (await response.json()) as {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
    };

    if (data.items) {
      allCalendars.push(...data.items);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) {
      break;
    }
  }

  logger.debug(`Response: ${allCalendars.length} calendars`);
  return allCalendars;
}

// =============================================================================
// Calendar API - Calendars
// =============================================================================

/**
 * Fetch calendar metadata
 */
export async function fetchCalendar(
  calendarId: string
): Promise<Record<string, unknown>> {
  const auth = await getAuthInfo();

  const calendarIdEncoded = encodeURIComponent(calendarId);
  const url = `${CALENDAR_API_BASE}/calendars/${calendarIdEncoded}`;

  logger.debug(`GET /calendars/${calendarId}`);
  const response = await requestWithRetry("GET", url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  const data = (await response.json()) as Record<string, unknown>;
  logger.debug(`Response: calendar metadata fetched`);
  return data;
}

// =============================================================================
// Calendar API - Event Creation
// =============================================================================

/**
 * Event creation input
 */
export interface CreateEventInput {
  summary: string;
  description?: string;
  startDateTime: string; // ISO 8601 format with timezone (e.g., "2025-01-15T09:00:00+09:00")
  endDateTime: string; // ISO 8601 format with timezone
  colorId?: string; // Google Calendar color ID (1-11 for events)
}

/**
 * Event creation result
 */
export interface CreateEventResult {
  id: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
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

  logger.debug(`POST /calendars/{id}/events: ${event.summary}`);

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
      logger.warn("Token expired, refreshing...");
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
  logger.debug(`Created event: ${data.id}`);
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

  logger.info(`Creating ${events.length} events...`);

  for (const event of events) {
    try {
      const result = await createEvent(event, calendarId);
      created.push(result);
      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create event "${event.summary}": ${message}`);
      failed.push({ event, error: message });
    }
  }

  logger.info(`Created ${created.length}/${events.length} events`);
  if (failed.length > 0) {
    logger.warn(`Failed: ${failed.length} events`);
  }

  return { created, failed };
}
