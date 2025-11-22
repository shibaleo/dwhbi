/**
 * Fitbit 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

import { RateLimitError } from "../../utils/errors.ts";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Fitbit レート制限エラー（429 Too Many Requests）
 */
export class FitbitRateLimitError extends RateLimitError {
  constructor(retryAfterSeconds: number, message?: string) {
    super(retryAfterSeconds, message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`);
    this.name = "FitbitRateLimitError";
  }
}

// =============================================================================
// Fitbit API Response Types
// =============================================================================

/** Sleep API レスポンス */
export interface FitbitApiSleepResponse {
  sleep: FitbitApiSleepLog[];
  summary?: FitbitApiSleepSummary;
}

export interface FitbitApiSleepLog {
  logId: number;
  dateOfSleep: string; // YYYY-MM-DD
  startTime: string; // ISO8601
  endTime: string; // ISO8601
  duration: number; // ミリ秒
  efficiency: number; // %
  isMainSleep: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  timeInBed: number;
  type: "stages" | "classic";
  levels?: FitbitApiSleepLevels;
}

export interface FitbitApiSleepLevels {
  data: FitbitApiSleepLevelData[];
  shortData?: FitbitApiSleepLevelData[];
  summary: Record<string, { count: number; minutes: number; thirtyDayAvgMinutes?: number }>;
}

export interface FitbitApiSleepLevelData {
  dateTime: string;
  level: string;
  seconds: number;
}

export interface FitbitApiSleepSummary {
  totalMinutesAsleep: number;
  totalSleepRecords: number;
  totalTimeInBed: number;
}

/** Activity Daily Summary レスポンス */
export interface FitbitApiActivityDailySummary {
  activities: unknown[];
  goals: FitbitApiActivityGoals;
  summary: FitbitApiActivitySummary;
}

export interface FitbitApiActivityGoals {
  activeMinutes: number;
  caloriesOut: number;
  distance: number;
  floors: number;
  steps: number;
}

export interface FitbitApiActivitySummary {
  steps: number;
  floors: number;
  caloriesOut: number;
  caloriesBMR: number;
  activityCalories: number;
  distances: { activity: string; distance: number }[];
  sedentaryMinutes: number;
  lightlyActiveMinutes: number;
  fairlyActiveMinutes: number;
  veryActiveMinutes: number;
}

/** Heart Rate Time Series レスポンス */
export interface FitbitApiHeartRateTimeSeriesResponse {
  "activities-heart": FitbitApiHeartRateDay[];
  "activities-heart-intraday"?: FitbitApiHeartRateIntraday;
}

export interface FitbitApiHeartRateDay {
  dateTime: string; // YYYY-MM-DD
  value: {
    customHeartRateZones?: FitbitApiHeartRateZone[];
    heartRateZones: FitbitApiHeartRateZone[];
    restingHeartRate?: number;
  };
}

export interface FitbitApiHeartRateZone {
  name: string;
  min: number;
  max: number;
  minutes: number;
  caloriesOut: number;
}

export interface FitbitApiHeartRateIntraday {
  dataset: { time: string; value: number }[];
  datasetInterval: number;
  datasetType: string;
}

/** HRV API レスポンス */
export interface FitbitApiHrvResponse {
  hrv: FitbitApiHrvDay[];
}

export interface FitbitApiHrvDay {
  dateTime: string;
  value: {
    dailyRmssd: number;
    deepRmssd: number;
  };
  minutes?: FitbitApiHrvMinute[];
}

export interface FitbitApiHrvMinute {
  minute: string;
  value: {
    rmssd: number;
    coverage: number;
    hf: number;
    lf: number;
  };
}

/** SpO2 API レスポンス */
export interface FitbitApiSpo2Response {
  dateTime?: string;
  value?: {
    avg: number;
    min: number;
    max: number;
  };
}

/** Breathing Rate API レスポンス */
export interface FitbitApiBreathingRateResponse {
  br: FitbitApiBreathingRateDay[];
}

export interface FitbitApiBreathingRateDay {
  dateTime: string;
  value: {
    breathingRate: number;
  };
}

/** Cardio Score (VO2 Max) API レスポンス */
export interface FitbitApiCardioScoreResponse {
  cardioScore: FitbitApiCardioScoreDay[];
}

export interface FitbitApiCardioScoreDay {
  dateTime: string;
  value: {
    vo2Max: string; // "30-35" 形式または数値
  };
}

/** Temperature Skin API レスポンス */
export interface FitbitApiTemperatureSkinResponse {
  tempSkin: FitbitApiTemperatureSkinDay[];
}

export interface FitbitApiTemperatureSkinDay {
  dateTime: string;
  value: {
    nightlyRelative: number;
  };
  logType?: string;
}

/** Active Zone Minutes API レスポンス */
export interface FitbitApiAzmResponse {
  "activities-active-zone-minutes": FitbitApiAzmDay[];
}

export interface FitbitApiAzmDay {
  dateTime: string;
  value: {
    activeZoneMinutes: number;
    fatBurnActiveZoneMinutes: number;
    cardioActiveZoneMinutes: number;
    peakActiveZoneMinutes: number;
  };
}

// =============================================================================
// Auth Types
// =============================================================================

/** OAuth2.0 トークンレスポンス */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // 秒
  token_type: string;
  scope: string;
  user_id: string;
}

/** 認証オプション */
export interface AuthOptions {
  forceRefresh?: boolean;
  thresholdMinutes?: number; // デフォルト: 60（Fitbitトークンは8時間有効）
}

// =============================================================================
// Database Table Types (fitbit schema)
// =============================================================================

/** fitbit.tokens テーブル */
export interface DbToken {
  id: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string; // ISO8601
  scope?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
  last_refreshed_at?: string;
}

/** fitbit.sleep テーブル */
export interface DbSleep {
  id?: string;
  date: string; // YYYY-MM-DD
  start_time: string; // ISO8601
  end_time: string; // ISO8601
  duration_ms?: number;
  efficiency?: number;
  is_main_sleep?: boolean;
  minutes_asleep?: number;
  minutes_awake?: number;
  time_in_bed?: number;
  sleep_type?: string;
  levels?: unknown; // JSONB
  log_id: number;
  synced_at?: string;
}

/** fitbit.activity_daily テーブル */
export interface DbActivityDaily {
  id?: string;
  date: string;
  steps?: number;
  distance_km?: number;
  floors?: number;
  calories_total?: number;
  calories_bmr?: number;
  calories_activity?: number;
  sedentary_minutes?: number;
  lightly_active_minutes?: number;
  fairly_active_minutes?: number;
  very_active_minutes?: number;
  active_zone_minutes?: unknown; // JSONB
  intraday?: unknown; // JSONB
  synced_at?: string;
}

/** fitbit.heart_rate_daily テーブル */
export interface DbHeartRateDaily {
  id?: string;
  date: string;
  resting_heart_rate?: number;
  heart_rate_zones?: unknown; // JSONB
  intraday?: unknown; // JSONB
  synced_at?: string;
}

/** fitbit.hrv_daily テーブル */
export interface DbHrvDaily {
  id?: string;
  date: string;
  daily_rmssd?: number;
  deep_rmssd?: number;
  intraday?: unknown; // JSONB
  synced_at?: string;
}

/** fitbit.spo2_daily テーブル */
export interface DbSpo2Daily {
  id?: string;
  date: string;
  avg_spo2?: number;
  min_spo2?: number;
  max_spo2?: number;
  intraday?: unknown; // JSONB
  synced_at?: string;
}

/** fitbit.breathing_rate_daily テーブル */
export interface DbBreathingRateDaily {
  id?: string;
  date: string;
  breathing_rate?: number;
  intraday?: unknown; // JSONB
  synced_at?: string;
}

/** fitbit.cardio_score_daily テーブル */
export interface DbCardioScoreDaily {
  id?: string;
  date: string;
  vo2_max?: number;
  vo2_max_range_low?: number;
  vo2_max_range_high?: number;
  synced_at?: string;
}

/** fitbit.temperature_skin_daily テーブル */
export interface DbTemperatureSkinDaily {
  id?: string;
  date: string;
  nightly_relative?: number;
  log_type?: string;
  synced_at?: string;
}

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

/** データ取得オプション */
export interface FetchOptions {
  startDate?: Date;
  endDate?: Date;
  includeIntraday?: boolean;
  /** レートリミット時に待機してリトライするか（デフォルト: false） */
  retryOnRateLimit?: boolean;
}

/** 取得データ（fetch_data.ts の出力） */
export interface FitbitData {
  sleep: FitbitApiSleepLog[];
  activity: Map<string, FitbitApiActivitySummary>;
  heartRate: FitbitApiHeartRateDay[];
  heartRateIntraday: Map<string, FitbitApiHeartRateIntraday>;
  hrv: FitbitApiHrvDay[];
  spo2: Map<string, FitbitApiSpo2Response>;
  breathingRate: FitbitApiBreathingRateDay[];
  cardioScore: FitbitApiCardioScoreDay[];
  temperatureSkin: FitbitApiTemperatureSkinDay[];
  azm: FitbitApiAzmDay[];
}

// =============================================================================
// Sync Result Types
// =============================================================================

/** 同期統計 */
export interface SyncStats {
  sleep: number;
  activity: number;
  heartRate: number;
  hrv: number;
  spo2: number;
  breathingRate: number;
  cardioScore: number;
  temperatureSkin: number;
}

/** 同期結果 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  errors: string[];
  elapsedSeconds: number;
}

// =============================================================================
// Type Aliases (後方互換性のため)
// =============================================================================

/** @deprecated Use FitbitApiSleepLog instead */
export type SleepLog = FitbitApiSleepLog;
/** @deprecated Use FitbitApiSleepLevels instead */
export type SleepLevels = FitbitApiSleepLevels;
/** @deprecated Use FitbitApiSleepLevelData instead */
export type SleepLevelData = FitbitApiSleepLevelData;
/** @deprecated Use FitbitApiSleepSummary instead */
export type SleepSummary = FitbitApiSleepSummary;
/** @deprecated Use FitbitApiActivitySummary instead */
export type ActivitySummary = FitbitApiActivitySummary;
/** @deprecated Use FitbitApiActivityGoals instead */
export type ActivityGoals = FitbitApiActivityGoals;
/** @deprecated Use FitbitApiHeartRateDay instead */
export type HeartRateDay = FitbitApiHeartRateDay;
/** @deprecated Use FitbitApiHeartRateZone instead */
export type HeartRateZone = FitbitApiHeartRateZone;
/** @deprecated Use FitbitApiHeartRateIntraday instead */
export type HeartRateIntraday = FitbitApiHeartRateIntraday;
/** @deprecated Use FitbitApiHrvDay instead */
export type HrvDay = FitbitApiHrvDay;
/** @deprecated Use FitbitApiHrvMinute instead */
export type HrvMinute = FitbitApiHrvMinute;
/** @deprecated Use FitbitApiSpo2Response instead */
export type Spo2ApiResponse = FitbitApiSpo2Response;
/** @deprecated Use FitbitApiBreathingRateDay instead */
export type BreathingRateDay = FitbitApiBreathingRateDay;
/** @deprecated Use FitbitApiCardioScoreDay instead */
export type CardioScoreDay = FitbitApiCardioScoreDay;
/** @deprecated Use FitbitApiTemperatureSkinDay instead */
export type TemperatureSkinDay = FitbitApiTemperatureSkinDay;
/** @deprecated Use FitbitApiAzmDay instead */
export type AzmDay = FitbitApiAzmDay;
