/**
 * Fitbit API Client
 *
 * OAuth 2.0 authentication (refresh token) and API calls.
 * Data fetching only, no DB operations.
 *
 * Credentials:
 * - Loaded from Supabase Vault (getCredentials("fitbit"))
 * - access_token is auto-refreshed when expired
 * - refresh_token is also updated on each refresh
 */

import { config } from "dotenv";
import {
  getCredentials,
  updateCredentials,
} from "../../lib/credentials-vault.js";
import { setupLogger } from "../../lib/logger.js";

// Load .env for local development
config();

const logger = setupLogger("fitbit-api");

// Configuration
const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const FITBIT_API_BASE = "https://api.fitbit.com";
const DEFAULT_THRESHOLD_MINUTES = 60;
const DEFAULT_RETRY_DELAY_SEC = 1;

// Chunk limits per data type
export const CHUNK_LIMITS = {
  sleep: 100,
  heartRate: 30,
  hrv: 30,
  spo2: 30,
  breathingRate: 30,
  cardioScore: 30,
  temperatureSkin: 30,
  activity: 1, // Must fetch one day at a time
} as const;

// Types
export interface AuthInfo {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token: string;
  scope: string;
  user_id: string;
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
 * Refresh access token from Fitbit OAuth
 */
async function refreshTokenFromApi(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<TokenResponse> {
  const response = await fetch(FITBIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
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
  const result = await getCredentials("fitbit");
  const credentials = result.credentials as Record<string, unknown>;
  let expiresAt = result.expiresAt;

  // Validate required fields
  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Missing client_id or client_secret");
  }
  if (!credentials.refresh_token) {
    throw new Error("Missing refresh_token. Run OAuth flow first.");
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
  let refreshToken = credentials.refresh_token as string;
  let currentExpiresAt = expiresAt;

  // Refresh if needed
  if (needsRefresh) {
    logger.info("Refreshing access token...");
    const newToken = await refreshTokenFromApi(
      credentials.client_id as string,
      credentials.client_secret as string,
      refreshToken
    );

    accessToken = newToken.access_token;
    refreshToken = newToken.refresh_token;
    // Fitbit token expires in 8 hours
    currentExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    // Update vault (refresh_token also changes)
    await updateCredentials(
      "fitbit",
      {
        access_token: accessToken,
        refresh_token: refreshToken,
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
    refreshToken,
  };
  cachedExpiresAt = currentExpiresAt;

  logger.debug("Auth initialized");
  return cachedAuth;
}

// =============================================================================
// Date utilities
// =============================================================================

/**
 * Format date for Fitbit API (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Convert Fitbit local datetime to UTC ISO8601
 * Fitbit returns times without timezone, we treat them as JST
 */
export function convertJstToUtc(jstTimeStr: string): string {
  // Add +09:00 if no timezone present
  if (!jstTimeStr.includes("+") && !jstTimeStr.includes("Z")) {
    const jstDate = new Date(jstTimeStr + "+09:00");
    return jstDate.toISOString();
  }
  return new Date(jstTimeStr).toISOString();
}

// =============================================================================
// API Request Helper
// =============================================================================

/**
 * Make authenticated API request
 */
async function apiRequest<T>(endpoint: string): Promise<T> {
  const auth = await getAuthInfo();

  logger.debug(`GET ${endpoint}`);

  try {
    const response = await requestWithRetry(`${FITBIT_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    });
    return (await response.json()) as T;
  } catch (error) {
    // Token expired, refresh and retry
    if (String(error).includes("401")) {
      logger.warn("Token expired, refreshing...");
      const newAuth = await getAuthInfo(true);
      const response = await requestWithRetry(`${FITBIT_API_BASE}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${newAuth.accessToken}`,
        },
      });
      return (await response.json()) as T;
    }
    throw error;
  }
}

// =============================================================================
// Sleep API
// =============================================================================

export interface SleepLog {
  logId: number;
  dateOfSleep: string;
  startTime: string;
  endTime: string;
  duration: number;
  efficiency: number;
  isMainSleep: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  timeInBed: number;
  type: string;
  levels?: {
    data: Array<{ dateTime: string; level: string; seconds: number }>;
    summary: Record<string, { count: number; minutes: number; thirtyDayAvgMinutes?: number }>;
    shortData?: Array<{ dateTime: string; level: string; seconds: number }>;
  };
}

interface SleepResponse {
  sleep: SleepLog[];
}

/**
 * Fetch sleep logs for date range
 */
export async function fetchSleep(
  startDate: Date,
  endDate: Date
): Promise<SleepLog[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const data = await apiRequest<SleepResponse>(
    `/1.2/user/-/sleep/date/${start}/${end}.json`
  );

  logger.debug(`Response: ${data.sleep?.length || 0} sleep records`);
  return data.sleep || [];
}

// =============================================================================
// Activity API
// =============================================================================

export interface ActivitySummary {
  date: string;
  steps: number;
  distances: Array<{ activity: string; distance: number }>;
  floors?: number;
  caloriesOut: number;
  caloriesBMR: number;
  activityCalories: number;
  sedentaryMinutes: number;
  lightlyActiveMinutes: number;
  fairlyActiveMinutes: number;
  veryActiveMinutes: number;
  activeZoneMinutes?: { fatBurn?: number; cardio?: number; peak?: number };
}

interface ActivityResponse {
  summary: ActivitySummary;
}

/**
 * Fetch activity summary for a single date
 */
export async function fetchActivity(date: Date): Promise<ActivitySummary | null> {
  const dateStr = formatDate(date);

  const data = await apiRequest<ActivityResponse>(
    `/1/user/-/activities/date/${dateStr}.json`
  );

  if (!data.summary) {
    logger.debug(`Response: no activity data for ${dateStr}`);
    return null;
  }

  logger.debug(`Response: activity data for ${dateStr}`);
  return { ...data.summary, date: dateStr };
}

// =============================================================================
// Heart Rate API
// =============================================================================

export interface HeartRateDay {
  dateTime: string;
  value: {
    restingHeartRate?: number;
    heartRateZones: Array<{
      name: string;
      min: number;
      max: number;
      minutes: number;
      caloriesOut: number;
    }>;
  };
}

interface HeartRateResponse {
  "activities-heart": HeartRateDay[];
}

/**
 * Fetch heart rate data for date range
 */
export async function fetchHeartRate(
  startDate: Date,
  endDate: Date
): Promise<HeartRateDay[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const data = await apiRequest<HeartRateResponse>(
    `/1/user/-/activities/heart/date/${start}/${end}.json`
  );

  logger.debug(`Response: ${data["activities-heart"]?.length || 0} heart rate records`);
  return data["activities-heart"] || [];
}

// =============================================================================
// HRV API
// =============================================================================

export interface HrvDay {
  dateTime: string;
  value: {
    dailyRmssd: number;
    deepRmssd: number;
  };
}

interface HrvResponse {
  hrv: HrvDay[];
}

/**
 * Fetch HRV data for date range
 */
export async function fetchHrv(
  startDate: Date,
  endDate: Date
): Promise<HrvDay[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const data = await apiRequest<HrvResponse>(
    `/1/user/-/hrv/date/${start}/${end}.json`
  );

  logger.debug(`Response: ${data.hrv?.length || 0} HRV records`);
  return data.hrv || [];
}

// =============================================================================
// SpO2 API
// =============================================================================

export interface Spo2Day {
  dateTime: string;
  value: {
    avg: number;
    min: number;
    max: number;
  };
}

interface Spo2Response {
  value?: Array<Spo2Day>;
}

/**
 * Fetch SpO2 data for date range
 */
export async function fetchSpo2(
  startDate: Date,
  endDate: Date
): Promise<Spo2Day[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  try {
    const data = await apiRequest<Spo2Response>(
      `/1/user/-/spo2/date/${start}/${end}.json`
    );

    const results = data.value || [];
    logger.debug(`Response: ${results.length} SpO2 records`);
    return results;
  } catch (error) {
    // SpO2 may return 404 if no data
    if (String(error).includes("404")) {
      logger.debug("Response: 0 SpO2 records (404)");
      return [];
    }
    throw error;
  }
}

// =============================================================================
// Breathing Rate API
// =============================================================================

export interface BreathingRateDay {
  dateTime: string;
  value: {
    breathingRate: number;
  };
}

interface BreathingRateResponse {
  br: BreathingRateDay[];
}

/**
 * Fetch breathing rate data for date range
 */
export async function fetchBreathingRate(
  startDate: Date,
  endDate: Date
): Promise<BreathingRateDay[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  try {
    const data = await apiRequest<BreathingRateResponse>(
      `/1/user/-/br/date/${start}/${end}.json`
    );

    logger.debug(`Response: ${data.br?.length || 0} breathing rate records`);
    return data.br || [];
  } catch (error) {
    if (String(error).includes("404")) {
      logger.debug("Response: 0 breathing rate records (404)");
      return [];
    }
    throw error;
  }
}

// =============================================================================
// Cardio Score (VO2 Max) API
// =============================================================================

export interface CardioScoreDay {
  dateTime: string;
  value: {
    vo2Max: string;  // e.g. "42-46"
  };
}

interface CardioScoreResponse {
  cardioScore: CardioScoreDay[];
}

/**
 * Fetch cardio score (VO2 Max) data for date range
 */
export async function fetchCardioScore(
  startDate: Date,
  endDate: Date
): Promise<CardioScoreDay[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  try {
    const data = await apiRequest<CardioScoreResponse>(
      `/1/user/-/cardioscore/date/${start}/${end}.json`
    );

    logger.debug(`Response: ${data.cardioScore?.length || 0} cardio score records`);
    return data.cardioScore || [];
  } catch (error) {
    if (String(error).includes("404")) {
      logger.debug("Response: 0 cardio score records (404)");
      return [];
    }
    throw error;
  }
}

// =============================================================================
// Temperature Skin API
// =============================================================================

export interface TemperatureSkinDay {
  dateTime: string;
  value: {
    nightlyRelative: number;
  };
  logType: string;
}

interface TemperatureSkinResponse {
  tempSkin: TemperatureSkinDay[];
}

/**
 * Fetch skin temperature data for date range
 */
export async function fetchTemperatureSkin(
  startDate: Date,
  endDate: Date
): Promise<TemperatureSkinDay[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  try {
    const data = await apiRequest<TemperatureSkinResponse>(
      `/1/user/-/temp/skin/date/${start}/${end}.json`
    );

    logger.debug(`Response: ${data.tempSkin?.length || 0} temperature records`);
    return data.tempSkin || [];
  } catch (error) {
    if (String(error).includes("404")) {
      logger.debug("Response: 0 temperature records (404)");
      return [];
    }
    throw error;
  }
}

// =============================================================================
// Chunked fetching
// =============================================================================

/**
 * Fetch data with chunking for periods exceeding limits
 */
export async function fetchWithChunks<T>(
  startDate: Date,
  endDate: Date,
  chunkDays: number,
  fetchFn: (start: Date, end: Date) => Promise<T[]>
): Promise<T[]> {
  const results: T[] = [];
  let currentStart = new Date(startDate);

  while (currentStart < endDate) {
    const chunkEnd = new Date(
      Math.min(
        currentStart.getTime() + chunkDays * 24 * 60 * 60 * 1000 - 1,
        endDate.getTime()
      )
    );

    const data = await fetchFn(currentStart, chunkEnd);
    results.push(...data);

    currentStart = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return results;
}

/**
 * Fetch activity data day by day
 */
export async function fetchActivityRange(
  startDate: Date,
  endDate: Date
): Promise<ActivitySummary[]> {
  const results: ActivitySummary[] = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const data = await fetchActivity(currentDate);
    if (data) {
      results.push(data);
    }
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }

  return results;
}
