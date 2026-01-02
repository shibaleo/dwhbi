/**
 * Google Calendar Service
 *
 * TypeScript connector for Google Calendar API.
 */

export { syncAll } from "./orchestrator";
export { syncEvents } from "./sync-events";
export { syncMasters } from "./sync-masters";
export {
  fetchEvents,
  fetchEventsBatch,
  fetchColors,
  fetchCalendarList,
  fetchCalendar,
  getAuthInfo,
  resetCache,
  createEvent,
  createEvents,
} from "./api-client";

// Types
export type { SyncAllResult, SyncOptions } from "./orchestrator";
export type { SyncResult } from "./sync-events";
export type { MasterSyncResult } from "./sync-masters";
export type { AuthInfo, CreateEventInput, CreateEventResult } from "./api-client";
