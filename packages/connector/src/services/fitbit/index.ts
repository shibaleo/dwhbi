/**
 * Fitbit Service
 *
 * TypeScript connector for Fitbit Web API.
 */

export { syncAll } from "./orchestrator";
export { syncSleep } from "./sync-sleep";
export {
  syncActivity,
  syncHeartRate,
  syncHrv,
  syncSpo2,
  syncBreathingRate,
  syncCardioScore,
  syncTemperatureSkin,
} from "./sync-daily";
export {
  getAuthInfo,
  resetCache,
  fetchSleep,
  fetchActivity,
  fetchActivityRange,
  fetchHeartRate,
  fetchHrv,
  fetchSpo2,
  fetchBreathingRate,
  fetchCardioScore,
  fetchTemperatureSkin,
} from "./api-client";

// Types
export type { SyncResult, SyncOptions } from "./orchestrator";
export type {
  AuthInfo,
  SleepLog,
  ActivitySummary,
  HeartRateDay,
  HrvDay,
  Spo2Day,
  BreathingRateDay,
  CardioScoreDay,
  TemperatureSkinDay,
} from "./api-client";
