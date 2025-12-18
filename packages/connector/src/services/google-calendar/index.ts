/**
 * Google Calendar Service
 *
 * TypeScript connector for Google Calendar API.
 */

export { syncAll } from "./orchestrator.ts";
export { syncEvents } from "./sync-events.ts";
export { syncMasters } from "./sync-masters.ts";
export {
  fetchEvents,
  fetchColors,
  fetchCalendarList,
  fetchCalendar,
  getAuthInfo,
  resetCache,
  createEvent,
  createEvents,
} from "./api-client.ts";

// Types
export type { SyncAllResult } from "./orchestrator.ts";
export type { SyncResult } from "./sync-events.ts";
export type { MasterSyncResult } from "./sync-masters.ts";
export type { AuthInfo, CreateEventInput, CreateEventResult } from "./api-client.ts";
