import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubConfig } from "@/lib/vault";

export interface WorkflowUsage {
  name: string;
  totalMs: number;
  billableMs: number;
  runCount: number;
}

export interface ActionsUsage {
  totalMinutesUsed: number;
  includedMinutes: number;
  percentUsed: number;
  workflows: WorkflowUsage[];
  billingPeriod: {
    year: number;
    month: number;
  };
}

// OSの乗数
const OS_MULTIPLIERS: Record<string, number> = {
  UBUNTU: 1,
  LINUX: 1,
  WINDOWS: 2,
  MACOS: 10,
};

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
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);


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

    // 完了したrunのみtiming APIを呼ぶ
    const completedRuns = runs.filter((run: { status: string }) => run.status === "completed");

    // 並列でtimingを取得（最大50件に制限）
    const timingPromises = completedRuns.slice(0, 50).map(async (run: { id: number; name: string }) => {
      try {
        const timingRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/timing`,
          {
            headers: {
              Authorization: `Bearer ${pat}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
        );

        if (!timingRes.ok) {
          return { runId: run.id, name: run.name, billableMs: 0 };
        }

        const timing = await timingRes.json();
        const billable = timing.billable || {};

        // OSごとの乗数を適用して合計
        // 無料枚内だとbillable.total_msが0になるので、run_duration_msを使用
        let totalBillableMs = 0;
        for (const [os, data] of Object.entries(billable)) {
          const osData = data as { total_ms?: number };
          const multiplier = OS_MULTIPLIERS[os.toUpperCase()] || 1;
          totalBillableMs += (osData.total_ms || 0) * multiplier;
        }

        // billableが0の場合はrun_duration_msを使用（無料枚内の場合）
        const effectiveBillableMs = totalBillableMs > 0 ? totalBillableMs : (timing.run_duration_ms || 0);

        return {
          runId: run.id,
          name: run.name,
          billableMs: effectiveBillableMs,
          runDurationMs: timing.run_duration_ms || 0,
        };
      } catch {
        return { runId: run.id, name: run.name, billableMs: 0 };
      }
    });

    const timingResults = await Promise.all(timingPromises);

    // ワークフローごとに集計
    const workflowUsage = new Map<string, { billableMs: number; runDurationMs: number; runCount: number }>();

    for (const result of timingResults) {
      const workflowName = result.name || "Unknown";
      const existing = workflowUsage.get(workflowName) || { billableMs: 0, runDurationMs: 0, runCount: 0 };
      workflowUsage.set(workflowName, {
        billableMs: existing.billableMs + (result.billableMs || 0),
        runDurationMs: existing.runDurationMs + (result.runDurationMs || 0),
        runCount: existing.runCount + 1,
      });
    }

    // 合計使用時間（分）を計算
    let totalBillableMs = 0;
    const workflows: WorkflowUsage[] = [];

    for (const [name, usage] of workflowUsage.entries()) {
      totalBillableMs += usage.billableMs;
      workflows.push({
        name,
        totalMs: usage.runDurationMs,
        billableMs: usage.billableMs,
        runCount: usage.runCount,
      });
    }

    // 使用時間の多い順にソート
    workflows.sort((a, b) => b.billableMs - a.billableMs);

    const totalMinutesUsed = Math.ceil(totalBillableMs / 1000 / 60);
    const includedMinutes = 2000; // GitHub Freeプランの無料枠

    const usage: ActionsUsage = {
      totalMinutesUsed,
      includedMinutes,
      percentUsed: Math.round((totalMinutesUsed / includedMinutes) * 100 * 10) / 10,
      workflows,
      billingPeriod: {
        year: year,
        month: month + 1, // 1-indexed
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
