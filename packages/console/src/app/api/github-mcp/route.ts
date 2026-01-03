import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubMcpConfig, saveGitHubMcpConfig, deleteGitHubMcpConfig } from "@/lib/vault";

function maskToken(token: string): string {
  if (token.length <= 12) return "****";
  return token.slice(0, 8) + "****" + token.slice(-4);
}

/**
 * GitHub PAT の有効性を確認
 */
async function validateGitHubToken(
  pat: string
): Promise<{ valid: boolean; error?: string; username?: string }> {
  try {
    const res = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 401) {
      return { valid: false, error: "トークンが無効です" };
    }

    if (res.status === 403) {
      return { valid: false, error: "アクセスが拒否されました" };
    }

    if (!res.ok) {
      return { valid: false, error: `GitHub API エラー: ${res.status}` };
    }

    const data = await res.json();
    return { valid: true, username: data.login };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return { valid: false, error: "GitHub に接続できません" };
    }
    return { valid: false, error: "検証中にエラーが発生しました" };
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await getGitHubMcpConfig();

    if (!config || !config.pat) {
      return NextResponse.json({ configured: false });
    }

    return NextResponse.json({
      configured: true,
      pat: maskToken(config.pat),
    });
  } catch (error) {
    console.error("Failed to get GitHub MCP config:", error);
    return NextResponse.json(
      { error: "Failed to get GitHub MCP config" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pat } = body;

    if (!pat) {
      return NextResponse.json(
        { error: "Personal Access Token is required" },
        { status: 400 }
      );
    }

    // トークンの有効性を検証
    const validation = await validateGitHubToken(pat);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    await saveGitHubMcpConfig({ pat });

    return NextResponse.json({ success: true, username: validation.username });
  } catch (error) {
    console.error("Failed to save GitHub MCP config:", error);
    return NextResponse.json(
      { error: "Failed to save GitHub MCP config" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteGitHubMcpConfig();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete GitHub MCP config:", error);
    return NextResponse.json(
      { error: "Failed to delete GitHub MCP config" },
      { status: 500 }
    );
  }
}
