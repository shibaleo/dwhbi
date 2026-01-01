/**
 * GitHub Contents Connector - Entry Point
 *
 * Syncs markdown documents from a GitHub repository to raw.docs_github table.
 *
 * Usage (CLI):
 *   npx tsx src/services/github-contents/index.ts
 *
 * Token and repositories are loaded from vault (github_contents secret).
 * Requires DIRECT_DATABASE_URL environment variable for vault access.
 */

import { config } from "dotenv";
import { getCredentials } from "../../lib/credentials-vault.js";
import { syncDocs, type SyncOptions } from "./orchestrator.js";

// Load .env for local development
config();

// Export for programmatic use by Console API
export { syncDocs, type SyncOptions } from "./orchestrator.js";
export type { SyncConfig, SyncResult } from "./types.js";

/**
 * Parse repositories string into array
 * Format: "owner/repo/path" per line
 */
function parseRepositories(repositories: string): Array<{ owner: string; repo: string; path: string }> {
  return repositories
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split("/");
      if (parts.length < 3) {
        throw new Error(`Invalid repository format: ${line}. Expected owner/repo/path`);
      }
      return {
        owner: parts[0],
        repo: parts[1],
        path: parts.slice(2).join("/") || ".",
      };
    });
}

// CLI entry point
async function main() {
  console.log("GitHub Contents Connector");
  console.log("=========================");
  console.log("");

  // Get config from vault
  console.log("Loading config from vault...");
  const { credentials } = await getCredentials("github_contents");

  const token = credentials.token as string;
  const repositoriesStr = credentials.repositories as string;

  if (!token) {
    throw new Error("Token not found in vault");
  }
  if (!repositoriesStr) {
    throw new Error("Repositories not configured in vault");
  }

  const repositories = parseRepositories(repositoriesStr);
  console.log(`Found ${repositories.length} repositories to sync`);
  console.log("");

  // Sync each repository
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  const allErrors: string[] = [];

  for (const repo of repositories) {
    console.log(`Syncing: ${repo.owner}/${repo.repo}/${repo.path}`);

    const options: SyncOptions = {
      token,
      owner: repo.owner,
      repo: repo.repo,
      path: repo.path,
    };

    try {
      const result = await syncDocs(options);
      totalAdded += result.added;
      totalUpdated += result.updated;
      totalDeleted += result.deleted;
      totalSkipped += result.skipped;
      allErrors.push(...result.errors.map(e => `${repo.owner}/${repo.repo}: ${e}`));

      console.log(`  Added: ${result.added}, Updated: ${result.updated}, Deleted: ${result.deleted}`);
    } catch (error) {
      const msg = `${repo.owner}/${repo.repo}: ${(error as Error).message}`;
      allErrors.push(msg);
      console.error(`  Error: ${(error as Error).message}`);
    }
  }

  console.log("");
  console.log("=========================");
  console.log("Total sync completed:");
  console.log(`  Added:   ${totalAdded}`);
  console.log(`  Updated: ${totalUpdated}`);
  console.log(`  Deleted: ${totalDeleted}`);
  console.log(`  Skipped: ${totalSkipped}`);

  if (allErrors.length > 0) {
    console.log("");
    console.log("Errors:");
    allErrors.forEach((err) => console.log(`  - ${err}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
