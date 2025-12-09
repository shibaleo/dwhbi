import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubConfig } from "@/lib/vault";

export interface WorkflowRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  html_url: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getGitHubConfig();
  if (!config) {
    return NextResponse.json({ configured: false, runs: [] });
  }

  try {
    // 最近のワークフロー実行を取得
    const res = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs?per_page=10`,
      {
        headers: {
          Authorization: `Bearer ${config.pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!res.ok) {
      console.error("GitHub API error:", res.status);
      return NextResponse.json({ configured: true, runs: [] });
    }

    const data = await res.json();
    const runs: WorkflowRun[] = data.workflow_runs.map((run: Record<string, unknown>) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      updated_at: run.updated_at,
      run_started_at: run.run_started_at,
      html_url: run.html_url,
    }));

    return NextResponse.json({ configured: true, runs });
  } catch (error) {
    console.error("Failed to fetch workflow runs:", error);
    return NextResponse.json({ configured: true, runs: [] });
  }
}
