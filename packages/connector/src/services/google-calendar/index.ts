/**
 * Google Calendar Service
 *
 * TypeScript connector for Google Calendar API.
 */

export { syncAll } from "./orchestrator.js";
export { syncEvents } from "./sync-events.js";
export { syncMasters } from "./sync-masters.js";
export {
  fetchEvents,
  fetchColors,
  fetchCalendarList,
  fetchCalendar,
  getAuthInfo,
  resetCache,
} from "./api-client.js";

// Types
export type { SyncAllResult } from "./orchestrator.js";
export type { SyncResult } from "./sync-events.js";
export type { MasterSyncResult } from "./sync-masters.js";
export type { AuthInfo } from "./api-client.js";
