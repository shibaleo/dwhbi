import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubConfig } from "@/lib/vault";

// ワークフロー名とファイル名のマッピング
const WORKFLOW_FILES: Record<string, string> = {
  toggl: "sync-toggl.yml",
  fitbit: "sync-fitbit.yml",
  zaim: "sync-zaim.yml",
  gcalendar: "sync-gcalendar.yml",
  tanita: "sync-tanita.yml",
  trello: "sync-trello.yml",
  ticktick: "sync-ticktick.yml",
  airtable: "sync-airtable.yml",
  daily: "sync-daily.yml",
  dbt: "dbt-run.yml",
};

type Params = Promise<{ workflow: string }>;

export async function POST(
  request: Request,
  { params }: { params: Params }
) {
  const { workflow } = await params;

  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ワークフロー名の検証
  const workflowFile = WORKFLOW_FILES[workflow];
  if (!workflowFile) {
    return NextResponse.json(
      { error: `Unknown workflow: ${workflow}` },
      { status: 400 }
    );
  }

  // GitHub設定を取得
  const config = await getGitHubConfig();
  if (!config) {
    return NextResponse.json(
      { error: "GitHub PAT is not configured" },
      { status: 400 }
    );
  }

  // リクエストボディからinputsを取得（オプション）
  let inputs: Record<string, string> = {};
  try {
    const body = await request.json();
    if (body.inputs) {
      inputs = body.inputs;
    }
  } catch {
    // ボディがない場合は無視
  }

  // GitHub Actions workflow dispatch API を呼び出し
  const dispatchUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${workflowFile}/dispatches`;

  try {
    const res = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("GitHub API error:", res.status, errorText);

      if (res.status === 404) {
        return NextResponse.json(
          { error: `Workflow not found: ${workflowFile}` },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: `GitHub API error: ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      workflow: workflowFile,
      message: `Workflow ${workflow} triggered successfully`,
    });
  } catch (error) {
    console.error("Failed to dispatch workflow:", error);
    return NextResponse.json(
      { error: "Failed to dispatch workflow" },
      { status: 500 }
    );
  }
}
