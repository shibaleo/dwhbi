// types.ts
// Fitbit API / DB 型定義

// ========== API レスポンス型 ==========

/** Sleep API レスポンス */
export interface SleepApiResponse {
  sleep: SleepLog[];
  summary?: SleepSummary;
}

export interface SleepLog {
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
  levels?: SleepLevels;
}

export interface SleepLevels {
  data: SleepLevelData[];
  shortData?: SleepLevelData[];
  summary: Record<string, { count: number; minutes: number; thirtyDayAvgMinutes?: number }>;
}

export interface SleepLevelData {
  dateTime: string;
  level: string;
  seconds: number;
}

export interface SleepSummary {
  totalMinutesAsleep: number;
  totalSleepRecords: number;
  totalTimeInBed: number;
}

/** Activity Daily Summary レスポンス */
export interface ActivityDailySummary {
  activities: unknown[];
  goals: ActivityGoals;
  summary: ActivitySummary;
}

export interface ActivityGoals {
  activeMinutes: number;
  caloriesOut: number;
  distance: number;
  floors: number;
  steps: number;
}

export interface ActivitySummary {
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
export interface HeartRateTimeSeriesResponse {
  "activities-heart": HeartRateDay[];
  "activities-heart-intraday"?: HeartRateIntraday;
}

export interface HeartRateDay {
  dateTime: string; // YYYY-MM-DD
  value: {
    customHeartRateZones?: HeartRateZone[];
    heartRateZones: HeartRateZone[];
    restingHeartRate?: number;
  };
}

export interface HeartRateZone {
  name: string;
  min: number;
  max: number;
  minutes: number;
  caloriesOut: number;
}

export interface HeartRateIntraday {
  dataset: { time: string; value: number }[];
  datasetInterval: number;
  datasetType: string;
}

/** HRV API レスポンス */
export interface HrvApiResponse {
  hrv: HrvDay[];
}

export interface HrvDay {
  dateTime: string;
  value: {
    dailyRmssd: number;
    deepRmssd: number;
  };
  minutes?: HrvMinute[];
}

export interface HrvMinute {
  minute: string;
  value: {
    rmssd: number;
    coverage: number;
    hf: number;
    lf: number;
  };
}

/** SpO2 API レスポンス */
export interface Spo2ApiResponse {
  dateTime?: string;
  value?: {
    avg: number;
    min: number;
    max: number;
  };
}

/** Breathing Rate API レスポンス */
export interface BreathingRateApiResponse {
  br: BreathingRateDay[];
}

export interface BreathingRateDay {
  dateTime: string;
  value: {
    breathingRate: number;
  };
}

/** Cardio Score (VO2 Max) API レスポンス */
export interface CardioScoreApiResponse {
  cardioScore: CardioScoreDay[];
}

export interface CardioScoreDay {
  dateTime: string;
  value: {
    vo2Max: string; // "30-35" 形式または数値
  };
}

/** Temperature Skin API レスポンス */
export interface TemperatureSkinApiResponse {
  tempSkin: TemperatureSkinDay[];
}

export interface TemperatureSkinDay {
  dateTime: string;
  value: {
    nightlyRelative: number;
  };
  logType?: string;
}

/** Active Zone Minutes API レスポンス */
export interface AzmApiResponse {
  "activities-active-zone-minutes": AzmDay[];
}

export interface AzmDay {
  dateTime: string;
  value: {
    activeZoneMinutes: number;
    fatBurnActiveZoneMinutes: number;
    cardioActiveZoneMinutes: number;
    peakActiveZoneMinutes: number;
  };
}

/** OAuth2.0 トークンレスポンス */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // 秒
  token_type: string;
  scope: string;
  user_id: string;
}

// ========== DB レコード型 ==========

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

// ========== 設定・オプション型 ==========

/** 認証オプション */
export interface AuthOptions {
  forceRefresh?: boolean;
  thresholdMinutes?: number; // デフォルト: 60（Fitbitトークンは8時間有効）
}

/** データ取得オプション */
export interface FetchOptions {
  startDate?: Date;
  endDate?: Date;
  includeIntraday?: boolean;
}

/** 同期結果 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: {
    sleep: number;
    activity: number;
    heartRate: number;
    hrv: number;
    spo2: number;
    breathingRate: number;
    cardioScore: number;
    temperatureSkin: number;
  };
  errors: string[];
  elapsedSeconds: number;
}

/** 取得データ（fetch_data.tsの出力） */
export interface FitbitData {
  sleep: SleepLog[];
  activity: Map<string, ActivitySummary>;
  heartRate: HeartRateDay[];
  heartRateIntraday: Map<string, HeartRateIntraday>;
  hrv: HrvDay[];
  spo2: Map<string, Spo2ApiResponse>;
  breathingRate: BreathingRateDay[];
  cardioScore: CardioScoreDay[];
  temperatureSkin: TemperatureSkinDay[];
  azm: AzmDay[];
}
