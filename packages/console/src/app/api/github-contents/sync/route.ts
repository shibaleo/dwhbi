import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubContentsConfig, parseRepositories } from "@/lib/vault";
import { syncDocs } from "@repo/connector/github-contents";

/**
 * Sync documents from GitHub to database
 *
 * Uses token and config from vault (github_contents secret)
 * Supports multiple repositories
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get config from vault
    const config = await getGitHubContentsConfig();

    if (!config) {
      return NextResponse.json(
        { error: "GitHub Contents not configured. Please set up the connection first." },
        { status: 400 }
      );
    }

    if (!config.token || !config.repositories) {
      return NextResponse.json(
        { error: "Incomplete GitHub Contents configuration" },
        { status: 400 }
      );
    }

    // Parse repositories
    const repositories = parseRepositories(config.repositories);

    if (repositories.length === 0) {
      return NextResponse.json(
        { error: "No repositories configured" },
        { status: 400 }
      );
    }

    // Sync each repository
    const results = [];
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (const repo of repositories) {
      try {
        const result = await syncDocs({
          token: config.token,
          owner: repo.owner,
          repo: repo.repo,
          path: repo.path,
        });

        results.push({
          repository: `${repo.owner}/${repo.repo}/${repo.path}`,
          added: result.added,
          updated: result.updated,
          deleted: result.deleted,
          skipped: result.skipped,
          errors: result.errors,
        });

        totalAdded += result.added;
        totalUpdated += result.updated;
        totalDeleted += result.deleted;
        totalSkipped += result.skipped;
        allErrors.push(...result.errors.map(e => `${repo.owner}/${repo.repo}: ${e}`));
      } catch (error) {
        const errorMsg = `${repo.owner}/${repo.repo}/${repo.path}: ${(error as Error).message}`;
        allErrors.push(errorMsg);
        results.push({
          repository: `${repo.owner}/${repo.repo}/${repo.path}`,
          error: (error as Error).message,
        });
      }
    }

    return NextResponse.json({
      success: allErrors.length === 0,
      summary: {
        added: totalAdded,
        updated: totalUpdated,
        deleted: totalDeleted,
        skipped: totalSkipped,
        errors: allErrors,
      },
      repositories: results,
    });
  } catch (error) {
    console.error("Failed to sync GitHub Contents:", error);
    return NextResponse.json(
      { error: `Sync failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
