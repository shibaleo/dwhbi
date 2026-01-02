/**
 * Tanita Health Planet API Client
 *
 * OAuth 2.0 authentication (refresh token) and API calls.
 * Data fetching only, no DB operations.
 *
 * Credentials:
 * - Loaded from Supabase Vault (getCredentials("tanita_health_planet"))
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

const logger = setupLogger("tanita-api");

// Configuration
const HEALTH_PLANET_TOKEN_URL = "https://www.healthplanet.jp/oauth/token";
const HEALTH_PLANET_API_BASE = "https://www.healthplanet.jp/status";
const DEFAULT_THRESHOLD_MINUTES = 30;
const DEFAULT_RETRY_DELAY_SEC = 1;
const MAX_DAYS_PER_REQUEST = 90;

// Measurement tags
const INNERSCAN_TAGS = "6021,6022"; // 体重, 体脂肪率
const SPHYGMOMANOMETER_TAGS = "622E,622F,6230"; // 最高血圧, 最低血圧, 脈拍

// Types
export interface AuthInfo {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri: string;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
}

export interface Measurement {
  date: string; // 12桁形式 (yyyyMMddHHmm)
  keydata: string;
  model: string;
  tag: string;
}

export interface BodyCompositionMeasurement extends Measurement {
  weight?: string;
  bodyFatPercent?: string;
}

export interface BloodPressureMeasurement extends Measurement {
  systolic?: string;
  diastolic?: string;
  pulse?: string;
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
function handleRateLimit(response: Response): number {
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
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let serverErrorRetried = false;

  while (true) {
    const response = await fetch(url, options);

    if (response.ok) {
      return response;
    }

    if (response.status === 429) {
      const waitSeconds = handleRateLimit(response);
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
 * Refresh access token from Health Planet OAuth
 */
async function refreshTokenFromApi(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  redirectUri: string
): Promise<TokenResponse> {
  const response = await fetch(HEALTH_PLANET_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      redirect_uri: redirectUri,
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
  const result = await getCredentials("tanita_health_planet");
  const credentials = result.credentials as Record<string, unknown>;
  let expiresAt = result.expiresAt;

  // Validate required fields
  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Missing client_id or client_secret");
  }
  if (!credentials.refresh_token) {
    throw new Error("Missing refresh_token. Run OAuth flow first.");
  }
  if (!credentials.redirect_uri) {
    throw new Error("Missing redirect_uri in credentials.");
  }

  // Check if refresh needed
  let needsRefresh = forceRefresh;
  if (!needsRefresh) {
    if (!expiresAt || !credentials.access_token) {
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
      credentials.refresh_token as string,
      credentials.redirect_uri as string
    );

    accessToken = newToken.access_token;
    // Health Planet token expires in 3 hours
    currentExpiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);

    // Update vault
    await updateCredentials(
      "tanita_health_planet",
      {
        access_token: accessToken,
      },
      currentExpiresAt
    );

    logger.info(`Token refreshed (expires: ${currentExpiresAt.toISOString()})`);
  }

  // Cache and return
  cachedAuth = {
    accessToken,
    clientId: credentials.client_id as string,
    clientSecret: credentials.client_secret as string,
    refreshToken: credentials.refresh_token as string,
    redirectUri: credentials.redirect_uri as string,
    scope: credentials.scope as string || "innerscan,sphygmomanometer",
  };
  cachedExpiresAt = currentExpiresAt;

  logger.debug("Auth initialized");
  return cachedAuth;
}

// =============================================================================
// Date utilities
// =============================================================================

/**
 * Format date for Tanita API request (14 digits: yyyyMMddHHmmss)
 */
export function formatTanitaRequestDate(date: Date): string {
  // Convert to JST
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
}

/**
 * Parse Tanita API response date (12 digits: yyyyMMddHHmm) to ISO8601 UTC
 */
export function parseTanitaResponseDate(dateStr: string): string {
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const hour = dateStr.slice(8, 10);
  const minute = dateStr.slice(10, 12);

  const jstDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`);
  return jstDate.toISOString();
}

/**
 * Get JST datetime string from Tanita response date
 */
export function toJstString(dateStr: string): string {
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const hour = dateStr.slice(8, 10);
  const minute = dateStr.slice(10, 12);

  return `${year}-${month}-${day}T${hour}:${minute}:00+09:00`;
}

// =============================================================================
// API - InnerScan (Body Composition)
// =============================================================================

interface InnerScanResponse {
  birth_date?: string;
  height?: string;
  sex?: string;
  data?: Array<{
    date: string;
    keydata: string;
    model: string;
    tag: string;
  }>;
}

/**
 * Fetch body composition data (innerscan)
 */
export async function fetchInnerScan(
  startDate: Date,
  endDate: Date
): Promise<BodyCompositionMeasurement[]> {
  const auth = await getAuthInfo();

  const from = formatTanitaRequestDate(startDate);
  const to = formatTanitaRequestDate(endDate);

  logger.debug(`GET /status/innerscan.json (${from} to ${to})`);

  const params = new URLSearchParams({
    access_token: auth.accessToken,
    date: "1", // 期間指定
    from,
    to,
    tag: INNERSCAN_TAGS,
  });

  let response: Response;
  try {
    response = await requestWithRetry(
      `${HEALTH_PLANET_API_BASE}/innerscan.json?${params}`
    );
  } catch (error) {
    // Token expired, refresh and retry
    if (String(error).includes("401")) {
      logger.warn("Token expired, refreshing...");
      const newAuth = await getAuthInfo(true);
      params.set("access_token", newAuth.accessToken);
      response = await requestWithRetry(
        `${HEALTH_PLANET_API_BASE}/innerscan.json?${params}`
      );
    } else {
      throw error;
    }
  }

  const data = (await response.json()) as InnerScanResponse;

  if (!data.data || data.data.length === 0) {
    logger.debug("Response: 0 body composition records");
    return [];
  }

  // Group measurements by date and build records
  const measurementsByDate = new Map<string, BodyCompositionMeasurement>();

  for (const item of data.data) {
    const existing = measurementsByDate.get(item.date) || {
      date: item.date,
      keydata: item.keydata,
      model: item.model,
      tag: item.tag,
    };

    if (item.tag === "6021") {
      existing.weight = item.keydata;
    } else if (item.tag === "6022") {
      existing.bodyFatPercent = item.keydata;
    }

    measurementsByDate.set(item.date, existing);
  }

  const measurements = Array.from(measurementsByDate.values());
  logger.debug(`Response: ${measurements.length} body composition records`);
  return measurements;
}

// =============================================================================
// API - Sphygmomanometer (Blood Pressure)
// =============================================================================

interface SphygmomanometerResponse {
  data?: Array<{
    date: string;
    keydata: string;
    model: string;
    tag: string;
  }>;
}

/**
 * Fetch blood pressure data (sphygmomanometer)
 */
export async function fetchSphygmomanometer(
  startDate: Date,
  endDate: Date
): Promise<BloodPressureMeasurement[]> {
  const auth = await getAuthInfo();

  const from = formatTanitaRequestDate(startDate);
  const to = formatTanitaRequestDate(endDate);

  logger.debug(`GET /status/sphygmomanometer.json (${from} to ${to})`);

  const params = new URLSearchParams({
    access_token: auth.accessToken,
    date: "1", // 期間指定
    from,
    to,
    tag: SPHYGMOMANOMETER_TAGS,
  });

  let response: Response;
  try {
    response = await requestWithRetry(
      `${HEALTH_PLANET_API_BASE}/sphygmomanometer.json?${params}`
    );
  } catch (error) {
    // Token expired, refresh and retry
    if (String(error).includes("401")) {
      logger.warn("Token expired, refreshing...");
      const newAuth = await getAuthInfo(true);
      params.set("access_token", newAuth.accessToken);
      response = await requestWithRetry(
        `${HEALTH_PLANET_API_BASE}/sphygmomanometer.json?${params}`
      );
    } else {
      throw error;
    }
  }

  const data = (await response.json()) as SphygmomanometerResponse;

  if (!data.data || data.data.length === 0) {
    logger.debug("Response: 0 blood pressure records");
    return [];
  }

  // Group measurements by date and build records
  const measurementsByDate = new Map<string, BloodPressureMeasurement>();

  for (const item of data.data) {
    const existing = measurementsByDate.get(item.date) || {
      date: item.date,
      keydata: item.keydata,
      model: item.model,
      tag: item.tag,
    };

    if (item.tag === "622E") {
      existing.systolic = item.keydata;
    } else if (item.tag === "622F") {
      existing.diastolic = item.keydata;
    } else if (item.tag === "6230") {
      existing.pulse = item.keydata;
    }

    measurementsByDate.set(item.date, existing);
  }

  const measurements = Array.from(measurementsByDate.values());
  logger.debug(`Response: ${measurements.length} blood pressure records`);
  return measurements;
}

// =============================================================================
// Chunked fetching (for periods > 90 days)
// =============================================================================

/**
 * Fetch data with chunking for periods > 90 days
 */
export async function fetchWithChunks<T>(
  startDate: Date,
  endDate: Date,
  fetchFn: (start: Date, end: Date) => Promise<T[]>
): Promise<T[]> {
  const results: T[] = [];
  let currentStart = new Date(startDate);

  while (currentStart < endDate) {
    const chunkEnd = new Date(
      Math.min(
        currentStart.getTime() + MAX_DAYS_PER_REQUEST * 24 * 60 * 60 * 1000,
        endDate.getTime()
      )
    );

    const data = await fetchFn(currentStart, chunkEnd);
    results.push(...data);

    currentStart = new Date(chunkEnd.getTime() + 1);
  }

  return results;
}
