/**
 * Fitbit - Daily Data Sync
 *
 * Syncs all daily data types:
 * - Activity
 * - Heart Rate
 * - HRV
 * - SpO2
 * - Breathing Rate
 * - Cardio Score
 * - Temperature Skin
 */

import { setupLogger } from "../../lib/logger.js";
import { upsertRaw, type RawRecord } from "../../db/raw-client.js";
import {
  fetchActivityRange,
  fetchActivityTimeSeriesWithChunks,
  fetchHeartRate,
  fetchHrv,
  fetchSpo2,
  fetchBreathingRate,
  fetchCardioScore,
  fetchTemperatureSkin,
  fetchWithChunks,
  CHUNK_LIMITS,
  type ActivitySummary,
  type ActivityTimeSeriesMerged,
  type HeartRateDay,
  type HrvDay,
  type Spo2Day,
  type BreathingRateDay,
  type CardioScoreDay,
  type TemperatureSkinDay,
} from "./api-client.js";

const logger = setupLogger("fitbit-sync-daily");

const API_VERSION = "v1";

// =============================================================================
// Activity
// =============================================================================

const ACTIVITY_TABLE = "fitbit__activity";

function activityToRawRecord(activity: ActivitySummary): RawRecord {
  const totalDistance = activity.distances?.find(d => d.activity === "total")?.distance || 0;

  return {
    sourceId: activity.date,
    data: {
      date: activity.date,
      steps: activity.steps,
      distance_km: totalDistance,
      floors: activity.floors,
      calories_total: activity.caloriesOut,
      calories_bmr: activity.caloriesBMR,
      calories_activity: activity.activityCalories,
      sedentary_minutes: activity.sedentaryMinutes,
      lightly_active_minutes: activity.lightlyActiveMinutes,
      fairly_active_minutes: activity.fairlyActiveMinutes,
      very_active_minutes: activity.veryActiveMinutes,
      active_zone_minutes: activity.activeZoneMinutes,
    },
  };
}

export async function syncActivity(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing activity data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing activity data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const activities = await fetchActivityRange(startDate, endDate);

  if (activities.length === 0) {
    logger.info("No activity data to sync");
    return 0;
  }

  const records = activities.map(activityToRawRecord);
  const result = await upsertRaw(ACTIVITY_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} activity records`);
  return result.total;
}

// =============================================================================
// Activity (Time Series API) - Faster, uses ~70% fewer API calls
// =============================================================================
//
// @deprecated Time Series API implementation is deprecated.
// Use Daily Summary API (syncActivity) instead - simpler and gets all fields.
//

/** @deprecated */
const API_VERSION_TIMESERIES = "v1-timeseries";

/** @deprecated */
function activityTimeSeriesMergedToRawRecord(activity: ActivityTimeSeriesMerged): RawRecord {
  return {
    sourceId: activity.date,
    data: {
      date: activity.date,
      steps: activity.steps,
      distance_km: activity.distance_km,
      floors: activity.floors,
      calories_total: activity.calories_total,
      calories_bmr: null, // Not available in Time Series API
      calories_activity: activity.calories_activity,
      sedentary_minutes: activity.sedentary_minutes,
      lightly_active_minutes: activity.lightly_active_minutes,
      fairly_active_minutes: activity.fairly_active_minutes,
      very_active_minutes: activity.very_active_minutes,
      active_zone_minutes: null, // Not available in Time Series API
    },
  };
}

/**
 * Sync activity data using Time Series API
 *
 * Faster than syncActivity (~70% fewer API calls):
 * - Daily Summary: 1 request per day = 2040 requests for 5+ years
 * - Time Series: 9 requests per 30-day chunk = 612 requests for 5+ years
 *
 * Trade-off: calories_bmr and active_zone_minutes not available
 *
 * @deprecated Use syncActivity (Daily Summary API) instead - simpler and gets all fields
 */
export async function syncActivityTimeSeries(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing activity data via Time Series API (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing activity data via Time Series API (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const activities = await fetchActivityTimeSeriesWithChunks(startDate, endDate);

  if (activities.length === 0) {
    logger.info("No activity data to sync");
    return 0;
  }

  const records = activities.map(activityTimeSeriesMergedToRawRecord);
  const result = await upsertRaw(ACTIVITY_TABLE, records, API_VERSION_TIMESERIES);

  logger.info(`Synced ${result.total} activity records via Time Series API`);
  return result.total;
}

// =============================================================================
// Heart Rate
// =============================================================================

const HEART_RATE_TABLE = "fitbit__heart_rate";

function heartRateToRawRecord(hr: HeartRateDay): RawRecord {
  return {
    sourceId: hr.dateTime,
    data: {
      date: hr.dateTime,
      resting_heart_rate: hr.value.restingHeartRate,
      heart_rate_zones: hr.value.heartRateZones,
    },
  };
}

export async function syncHeartRate(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing heart rate data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing heart rate data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const heartRates = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.heartRate,
    fetchHeartRate
  );

  if (heartRates.length === 0) {
    logger.info("No heart rate data to sync");
    return 0;
  }

  const records = heartRates.map(heartRateToRawRecord);
  const result = await upsertRaw(HEART_RATE_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} heart rate records`);
  return result.total;
}

// =============================================================================
// HRV
// =============================================================================

const HRV_TABLE = "fitbit__hrv";

function hrvToRawRecord(hrv: HrvDay): RawRecord {
  return {
    sourceId: hrv.dateTime,
    data: {
      date: hrv.dateTime,
      daily_rmssd: hrv.value.dailyRmssd,
      deep_rmssd: hrv.value.deepRmssd,
    },
  };
}

export async function syncHrv(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing HRV data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing HRV data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const hrvData = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.hrv,
    fetchHrv
  );

  if (hrvData.length === 0) {
    logger.info("No HRV data to sync");
    return 0;
  }

  const records = hrvData.map(hrvToRawRecord);
  const result = await upsertRaw(HRV_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} HRV records`);
  return result.total;
}

// =============================================================================
// SpO2
// =============================================================================

const SPO2_TABLE = "fitbit__spo2";

function spo2ToRawRecord(spo2: Spo2Day): RawRecord {
  return {
    sourceId: spo2.dateTime,
    data: {
      date: spo2.dateTime,
      avg_spo2: spo2.value.avg,
      min_spo2: spo2.value.min,
      max_spo2: spo2.value.max,
    },
  };
}

export async function syncSpo2(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing SpO2 data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing SpO2 data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const spo2Data = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.spo2,
    fetchSpo2
  );

  if (spo2Data.length === 0) {
    logger.info("No SpO2 data to sync");
    return 0;
  }

  const records = spo2Data.map(spo2ToRawRecord);
  const result = await upsertRaw(SPO2_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} SpO2 records`);
  return result.total;
}

// =============================================================================
// Breathing Rate
// =============================================================================

const BREATHING_RATE_TABLE = "fitbit__breathing_rate";

function breathingRateToRawRecord(br: BreathingRateDay): RawRecord {
  return {
    sourceId: br.dateTime,
    data: {
      date: br.dateTime,
      breathing_rate: br.value.breathingRate,
    },
  };
}

export async function syncBreathingRate(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing breathing rate data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing breathing rate data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const brData = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.breathingRate,
    fetchBreathingRate
  );

  if (brData.length === 0) {
    logger.info("No breathing rate data to sync");
    return 0;
  }

  const records = brData.map(breathingRateToRawRecord);
  const result = await upsertRaw(BREATHING_RATE_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} breathing rate records`);
  return result.total;
}

// =============================================================================
// Cardio Score (VO2 Max)
// =============================================================================

const CARDIO_SCORE_TABLE = "fitbit__cardio_score";

function cardioScoreToRawRecord(cs: CardioScoreDay): RawRecord {
  // Parse VO2 Max range (e.g. "42-46")
  const vo2MaxStr = cs.value.vo2Max;
  let vo2Max: number | null = null;
  let vo2MaxRangeLow: number | null = null;
  let vo2MaxRangeHigh: number | null = null;

  if (vo2MaxStr) {
    const parts = vo2MaxStr.split("-");
    if (parts.length === 2) {
      vo2MaxRangeLow = parseFloat(parts[0]);
      vo2MaxRangeHigh = parseFloat(parts[1]);
      vo2Max = (vo2MaxRangeLow + vo2MaxRangeHigh) / 2;
    } else {
      vo2Max = parseFloat(vo2MaxStr);
    }
  }

  return {
    sourceId: cs.dateTime,
    data: {
      date: cs.dateTime,
      vo2_max: vo2Max,
      vo2_max_range_low: vo2MaxRangeLow,
      vo2_max_range_high: vo2MaxRangeHigh,
    },
  };
}

export async function syncCardioScore(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing cardio score data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing cardio score data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const csData = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.cardioScore,
    fetchCardioScore
  );

  if (csData.length === 0) {
    logger.info("No cardio score data to sync");
    return 0;
  }

  const records = csData.map(cardioScoreToRawRecord);
  const result = await upsertRaw(CARDIO_SCORE_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} cardio score records`);
  return result.total;
}

// =============================================================================
// Temperature Skin
// =============================================================================

const TEMPERATURE_SKIN_TABLE = "fitbit__temperature_skin";

function temperatureSkinToRawRecord(ts: TemperatureSkinDay): RawRecord {
  return {
    sourceId: ts.dateTime,
    data: {
      date: ts.dateTime,
      nightly_relative: ts.value.nightlyRelative,
      log_type: ts.logType,
    },
  };
}

export async function syncTemperatureSkin(startDateOrDays: Date | number = 30, endDateParam?: Date): Promise<number> {
  let startDate: Date;
  let endDate: Date;

  if (typeof startDateOrDays === "number") {
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - startDateOrDays);
    logger.info(`Syncing temperature skin data (${startDateOrDays} days)...`);
  } else {
    startDate = startDateOrDays;
    endDate = endDateParam || new Date();
    logger.info(`Syncing temperature skin data (${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)})...`);
  }

  const tsData = await fetchWithChunks(
    startDate,
    endDate,
    CHUNK_LIMITS.temperatureSkin,
    fetchTemperatureSkin
  );

  if (tsData.length === 0) {
    logger.info("No temperature skin data to sync");
    return 0;
  }

  const records = tsData.map(temperatureSkinToRawRecord);
  const result = await upsertRaw(TEMPERATURE_SKIN_TABLE, records, API_VERSION);

  logger.info(`Synced ${result.total} temperature skin records`);
  return result.total;
}
