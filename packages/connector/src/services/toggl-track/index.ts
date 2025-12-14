/**
 * Toggl Track Service
 *
 * TypeScript connector for Toggl Track API.
 */

export { syncAll } from "./orchestrator.js";
export { syncTimeEntries } from "./sync-time-entries.js";
export { syncTimeEntriesReport } from "./sync-time-entries-report.js";
export { syncMasters } from "./sync-masters.js";
export {
  fetchTimeEntries,
  fetchProjects,
  fetchClients,
  fetchTags,
  fetchMe,
  fetchWorkspaces,
  fetchWorkspaceUsers,
  fetchWorkspaceGroups,
  fetchDetailedReport,
  fetchAllDetailedReport,
  getAuthInfo,
  resetCache,
} from "./api-client.js";

// Types
export type { SyncAllResult } from "./orchestrator.js";
export type { SyncResult } from "./sync-time-entries.js";
export type { SyncResult as ReportSyncResult } from "./sync-time-entries-report.js";
export type { MasterSyncResult } from "./sync-masters.js";
export type { AuthInfo } from "./api-client.js";
