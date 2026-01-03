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
const DEFAULT_RETRY_DELAY_SEC = 60; // Default wait time when Retry-After header is missing
const MAX_RETRY_DELAY_SEC = 3600; // Max 1 hour wait
const BACKOFF_MULTIPLIER = 2; // Exponential backoff multiplier
const RATE_LIMIT_BUFFER = 5; // Stop when remaining requests drops to this number

// Chunk limits per data type
export const CHUNK_LIMITS = {
  sleep: 100,
  heartRate: 30,
  hrv: 30,
  spo2: 30,
  breathingRate: 30,
  cardioScore: 30,
  temperatureSkin: 30,
  activity: 1, // Must fetch one day at a time (Daily Summary API)
  activityTimeSeries: 30, // Time Series API supports up to 30 days
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
let refreshInProgress: Promise<AuthInfo> | null = null; // Prevent concurrent refresh

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

  // Fallback: use Fitbit-Rate-Limit-Reset header (seconds until reset)
  const resetSeconds = response.headers.get("Fitbit-Rate-Limit-Reset");
  if (resetSeconds) {
    const seconds = parseInt(resetSeconds, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds;
    }
  }

  return DEFAULT_RETRY_DELAY_SEC;
}

/**
 * Check rate limit headers and wait proactively if quota is low
 * Returns true if we waited, false otherwise
 */
async function checkRateLimitProactively(response: Response): Promise<boolean> {
  const remaining = response.headers.get("Fitbit-Rate-Limit-Remaining");
  const resetSeconds = response.headers.get("Fitbit-Rate-Limit-Reset");

  if (remaining && resetSeconds) {
    const remainingCount = parseInt(remaining, 10);
    const resetSec = parseInt(resetSeconds, 10);

    if (!isNaN(remainingCount) && !isNaN(resetSec)) {
      // Log current quota status periodically
      if (remainingCount % 25 === 0 || remainingCount <= 10) {
        logger.info(`Rate limit: ${remainingCount} requests remaining, resets in ${Math.ceil(resetSec / 60)} min`);
      }

      // Proactively wait if quota is nearly exhausted
      if (remainingCount <= RATE_LIMIT_BUFFER) {
        const waitSeconds = resetSec + 5; // Add 5 seconds buffer
        const waitMinutes = (waitSeconds / 60).toFixed(1);
        logger.info(`Rate limit nearly exhausted (${remainingCount} remaining). Waiting ${waitMinutes} min for reset...`);
        await new Promise(r => setTimeout(r, waitSeconds * 1000));
        logger.info("Resuming after proactive rate limit wait");
        return true;
      }
    }
  }

  return false;
}

/**
 * HTTP request with retry for rate limits
 * Uses exponential backoff when Retry-After header is not provided
 * Also proactively waits when quota is nearly exhausted
 */
async function requestWithRetry(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let serverErrorRetried = false;
  let consecutiveRateLimits = 0;

  while (true) {
    const response = await fetch(url, options);

    if (response.ok) {
      consecutiveRateLimits = 0; // Reset on success

      // Check if we should wait proactively before next request
      await checkRateLimitProactively(response);

      return response;
    }

    if (response.status === 429) {
      consecutiveRateLimits++;
      let waitSeconds = handleRateLimit(response);

      // If no Retry-After header, use exponential backoff
      if (waitSeconds === DEFAULT_RETRY_DELAY_SEC && consecutiveRateLimits > 1) {
        waitSeconds = Math.min(
          DEFAULT_RETRY_DELAY_SEC * Math.pow(BACKOFF_MULTIPLIER, consecutiveRateLimits - 1),
          MAX_RETRY_DELAY_SEC
        );
      }

      const waitMinutes = (waitSeconds / 60).toFixed(1);
      logger.warn(`Rate limited (429). Waiting ${waitSeconds}s (${waitMinutes}min)... [attempt ${consecutiveRateLimits}]`);
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      continue;
    }

    if (response.status >= 500 && response.status < 600) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        logger.warn(`Server error (${response.status}). Retrying once...`);
        await new Promise((r) => setTimeout(r, 5 * 1000)); // 5 seconds for server errors
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
 * Internal: Actually perform the auth refresh
 */
async function doGetAuthInfo(forceRefresh: boolean): Promise<AuthInfo> {
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

/**
 * Get authentication info (cached with auto-refresh)
 * Uses a lock to prevent concurrent refresh requests
 */
export async function getAuthInfo(forceRefresh: boolean = false): Promise<AuthInfo> {
  // Check cache first (fast path, no lock needed)
  if (!forceRefresh && cachedAuth !== null && cachedExpiresAt !== null) {
    const minutesUntilExpiry =
      (cachedExpiresAt.getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > DEFAULT_THRESHOLD_MINUTES) {
      logger.debug(`Using cached auth (${Math.round(minutesUntilExpiry)} min until expiry)`);
      return cachedAuth;
    }
  }

  // If refresh is already in progress, wait for it
  if (refreshInProgress !== null) {
    logger.debug("Waiting for existing refresh to complete...");
    return refreshInProgress;
  }

  // Start refresh with lock
  refreshInProgress = doGetAuthInfo(forceRefresh);

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
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
 * Fetch activity data day by day (Daily Summary API)
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

// =============================================================================
// Activity Time Series API
// =============================================================================
//
// @deprecated Time Series API implementation is deprecated.
// While it uses ~70% fewer API calls, the complexity of rate limit management
// (parallel requests, burst prevention, token refresh locks) outweighs the benefits.
// Use Daily Summary API (fetchActivityRange) instead - simpler and gets all fields.
//

/**
 * Activity Time Series resources
 * Each resource requires a separate API call
 * @deprecated Use Daily Summary API instead
 */
export const ACTIVITY_TIME_SERIES_RESOURCES = [
  "steps",
  "floors",
  "distance",
  "calories",
  "minutesSedentary",
  "minutesLightlyActive",
  "minutesFairlyActive",
  "minutesVeryActive",
  "activityCalories",
] as const;

export type ActivityTimeSeriesResource = typeof ACTIVITY_TIME_SERIES_RESOURCES[number];

export interface ActivityTimeSeriesEntry {
  dateTime: string;
  value: string;
}

interface ActivityTimeSeriesResponse {
  [key: string]: ActivityTimeSeriesEntry[];
}

/**
 * Fetch a single activity time series resource for date range
 * Max 30 days per request
 * @deprecated Use Daily Summary API instead
 */
export async function fetchActivityTimeSeries(
  resource: ActivityTimeSeriesResource,
  startDate: Date,
  endDate: Date
): Promise<ActivityTimeSeriesEntry[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const data = await apiRequest<ActivityTimeSeriesResponse>(
    `/1/user/-/activities/${resource}/date/${start}/${end}.json`
  );

  // Response key is like "activities-steps", "activities-floors", etc.
  const responseKey = `activities-${resource}`;
  const results = data[responseKey] || [];

  logger.debug(`Response: ${results.length} ${resource} records`);
  return results;
}

/**
 * Merged activity data from Time Series API
 * Same structure as ActivitySummary for DB compatibility
 * @deprecated Use Daily Summary API instead
 */
export interface ActivityTimeSeriesMerged {
  date: string;
  steps: number;
  floors: number;
  distance_km: number;
  calories_total: number;
  calories_activity: number;
  sedentary_minutes: number;
  lightly_active_minutes: number;
  fairly_active_minutes: number;
  very_active_minutes: number;
}

/**
 * Fetch all activity time series resources and merge by date
 * Uses 9 API calls per chunk (vs 30 calls for daily summary)
 * @deprecated Use Daily Summary API instead
 */
export async function fetchActivityTimeSeriesRange(
  startDate: Date,
  endDate: Date
): Promise<ActivityTimeSeriesMerged[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  logger.debug(`Fetching activity time series (${start} to ${end})...`);

  // Fetch all resources in parallel (within same chunk)
  const [
    stepsData,
    floorsData,
    distanceData,
    caloriesData,
    sedentaryData,
    lightlyActiveData,
    fairlyActiveData,
    veryActiveData,
    activityCaloriesData,
  ] = await Promise.all([
    fetchActivityTimeSeries("steps", startDate, endDate),
    fetchActivityTimeSeries("floors", startDate, endDate),
    fetchActivityTimeSeries("distance", startDate, endDate),
    fetchActivityTimeSeries("calories", startDate, endDate),
    fetchActivityTimeSeries("minutesSedentary", startDate, endDate),
    fetchActivityTimeSeries("minutesLightlyActive", startDate, endDate),
    fetchActivityTimeSeries("minutesFairlyActive", startDate, endDate),
    fetchActivityTimeSeries("minutesVeryActive", startDate, endDate),
    fetchActivityTimeSeries("activityCalories", startDate, endDate),
  ]);

  // Build lookup maps by date
  const stepsMap = new Map(stepsData.map(d => [d.dateTime, d.value]));
  const floorsMap = new Map(floorsData.map(d => [d.dateTime, d.value]));
  const distanceMap = new Map(distanceData.map(d => [d.dateTime, d.value]));
  const caloriesMap = new Map(caloriesData.map(d => [d.dateTime, d.value]));
  const sedentaryMap = new Map(sedentaryData.map(d => [d.dateTime, d.value]));
  const lightlyActiveMap = new Map(lightlyActiveData.map(d => [d.dateTime, d.value]));
  const fairlyActiveMap = new Map(fairlyActiveData.map(d => [d.dateTime, d.value]));
  const veryActiveMap = new Map(veryActiveData.map(d => [d.dateTime, d.value]));
  const activityCaloriesMap = new Map(activityCaloriesData.map(d => [d.dateTime, d.value]));

  // Collect all unique dates
  const allDates = new Set<string>();
  stepsData.forEach(d => allDates.add(d.dateTime));

  // Merge into single records
  const results: ActivityTimeSeriesMerged[] = [];

  for (const date of allDates) {
    const steps = parseInt(stepsMap.get(date) || "0", 10);
    // Skip days with no activity (all zeros)
    if (steps === 0) continue;

    results.push({
      date,
      steps,
      floors: parseInt(floorsMap.get(date) || "0", 10),
      distance_km: parseFloat(distanceMap.get(date) || "0"),
      calories_total: parseInt(caloriesMap.get(date) || "0", 10),
      calories_activity: parseInt(activityCaloriesMap.get(date) || "0", 10),
      sedentary_minutes: parseInt(sedentaryMap.get(date) || "0", 10),
      lightly_active_minutes: parseInt(lightlyActiveMap.get(date) || "0", 10),
      fairly_active_minutes: parseInt(fairlyActiveMap.get(date) || "0", 10),
      very_active_minutes: parseInt(veryActiveMap.get(date) || "0", 10),
    });
  }

  // Sort by date
  results.sort((a, b) => a.date.localeCompare(b.date));

  logger.debug(`Merged ${results.length} activity records from time series`);
  return results;
}

// Rate limit management for parallel requests
const RATE_LIMIT_PER_HOUR = 150;
const REQUESTS_PER_CHUNK = 9; // 9 parallel requests per chunk
const SAFE_CHUNKS_PER_HOUR = Math.floor(RATE_LIMIT_PER_HOUR / REQUESTS_PER_CHUNK); // 16 chunks
const RATE_LIMIT_WAIT_MS = 60 * 60 * 1000; // 1 hour in ms

/**
 * Fetch activity time series with chunking (30 days per chunk)
 * Includes rate limit management: waits after every 16 chunks to avoid 429
 * @deprecated Use Daily Summary API instead
 */
export async function fetchActivityTimeSeriesWithChunks(
  startDate: Date,
  endDate: Date
): Promise<ActivityTimeSeriesMerged[]> {
  const results: ActivityTimeSeriesMerged[] = [];
  let currentStart = new Date(startDate);
  const chunkDays = CHUNK_LIMITS.activityTimeSeries;
  let chunkCount = 0;

  while (currentStart < endDate) {
    // Rate limit check: after 16 chunks (144 requests), wait 1 hour
    if (chunkCount > 0 && chunkCount % SAFE_CHUNKS_PER_HOUR === 0) {
      const waitMinutes = RATE_LIMIT_WAIT_MS / 1000 / 60;
      logger.info(`Rate limit prevention: processed ${chunkCount} chunks (${chunkCount * REQUESTS_PER_CHUNK} requests). Waiting ${waitMinutes} minutes...`);
      await new Promise(r => setTimeout(r, RATE_LIMIT_WAIT_MS));
      logger.info("Resuming after rate limit wait...");
    }

    const chunkEnd = new Date(
      Math.min(
        currentStart.getTime() + chunkDays * 24 * 60 * 60 * 1000 - 1,
        endDate.getTime()
      )
    );

    const data = await fetchActivityTimeSeriesRange(currentStart, chunkEnd);
    results.push(...data);
    chunkCount++;

    const start = formatDate(currentStart);
    const end = formatDate(chunkEnd);
    logger.info(`Chunk ${chunkCount}: ${start} to ${end} - ${data.length} records`);

    currentStart = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return results;
}
