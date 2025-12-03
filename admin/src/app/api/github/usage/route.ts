import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubConfig } from "@/lib/vault";

export interface WorkflowUsage {
  name: string;
  totalMs: number;
  runCount: number;
}

export interface ActionsUsage {
  totalMinutesUsed: number;
  includedMinutes: number;
  percentUsed: number;
  workflows: WorkflowUsage[];
  billingPeriod: {
    start: string;
    end: string;
  };
}

/**
 * 今月のGitHub Actions使用量を取得
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await getGitHubConfig();

    if (!config) {
      return NextResponse.json(
        { error: "GitHub設定が見つかりません" },
        { status: 404 }
      );
    }

    const { pat, owner, repo } = config;

    // 今月の開始日と終了日を計算
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // ワークフロー実行履歴を取得（今月分）
    const runsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?created=>=${startOfMonth.toISOString().split("T")[0]}&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!runsRes.ok) {
      const errorText = await runsRes.text();
      console.error("GitHub API error:", runsRes.status, errorText);

      if (runsRes.status === 403) {
        return NextResponse.json(
          { error: "Actions権限がありません。PATに 'actions:read' スコープを追加してください。" },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: "GitHub APIエラー" },
        { status: runsRes.status }
      );
    }

    const runsData = await runsRes.json();
    const runs = runsData.workflow_runs || [];

    // ワークフローごとの使用時間を集計
    const workflowUsage = new Map<string, { totalMs: number; runCount: number }>();

    for (const run of runs) {
      if (run.status !== "completed") continue;

      const workflowName = run.name || "Unknown";
      const startTime = new Date(run.run_started_at || run.created_at);
      const endTime = new Date(run.updated_at);
      const durationMs = endTime.getTime() - startTime.getTime();

      const existing = workflowUsage.get(workflowName) || { totalMs: 0, runCount: 0 };
      workflowUsage.set(workflowName, {
        totalMs: existing.totalMs + Math.max(0, durationMs),
        runCount: existing.runCount + 1,
      });
    }

    // 合計使用時間（分）を計算
    let totalMs = 0;
    const workflows: WorkflowUsage[] = [];

    for (const [name, usage] of workflowUsage.entries()) {
      totalMs += usage.totalMs;
      workflows.push({
        name,
        totalMs: usage.totalMs,
        runCount: usage.runCount,
      });
    }

    // 使用時間の多い順にソート
    workflows.sort((a, b) => b.totalMs - a.totalMs);

    const totalMinutesUsed = Math.ceil(totalMs / 1000 / 60);
    const includedMinutes = 2000; // GitHub Freeプランの無料枠

    const usage: ActionsUsage = {
      totalMinutesUsed,
      includedMinutes,
      percentUsed: Math.round((totalMinutesUsed / includedMinutes) * 100 * 10) / 10,
      workflows,
      billingPeriod: {
        start: startOfMonth.toISOString().split("T")[0],
        end: endOfMonth.toISOString().split("T")[0],
      },
    };

    return NextResponse.json(usage);
  } catch (error) {
    console.error("Failed to get Actions usage:", error);
    return NextResponse.json(
      { error: "使用量の取得に失敗しました" },
      { status: 500 }
    );
  }
}
