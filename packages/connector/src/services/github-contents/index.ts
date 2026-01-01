/**
 * GitHub Contents Connector
 *
 * Syncs markdown documents from GitHub repositories to raw.docs_github table.
 *
 * For CLI usage, run cli.ts directly:
 *   npx tsx src/services/github-contents/cli.ts
 */

// Export for programmatic use by Console API
export { syncDocs, type SyncOptions } from "./orchestrator.js";
export type { SyncConfig, SyncResult } from "./types.js";
