import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getGitHubContentsConfig,
  saveGitHubContentsConfig,
  deleteGitHubContentsConfig,
  type GitHubContentsConfig,
} from "@/lib/vault";

/**
 * GitHub Contents設定を取得（マスク済み）
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await getGitHubContentsConfig();

    if (!config) {
      return NextResponse.json({ connected: false, config: null });
    }

    // トークンをマスク
    const maskedConfig = {
      token: config.token.length > 8
        ? config.token.slice(0, 4) + "..." + config.token.slice(-4)
        : "****",
      owner: config.owner,
      repo: config.repo,
      path: config.path,
      expiresAt: config.expiresAt,
    };

    return NextResponse.json({
      connected: true,
      config: maskedConfig,
    });
  } catch (error) {
    console.error("Failed to get GitHub Contents config:", error);
    return NextResponse.json(
      { error: "Failed to get GitHub Contents config" },
      { status: 500 }
    );
  }
}

/**
 * GitHub Contents設定を保存
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { token, owner, repo, path, expiresAt } = body;

    if (!token || !owner || !repo || !path) {
      return NextResponse.json(
        { error: "token, owner, repo, and path are required" },
        { status: 400 }
      );
    }

    const config: GitHubContentsConfig = {
      token,
      owner,
      repo,
      path,
      expiresAt: expiresAt || null,
    };

    await saveGitHubContentsConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save GitHub Contents config:", error);
    return NextResponse.json(
      { error: "Failed to save GitHub Contents config" },
      { status: 500 }
    );
  }
}

/**
 * GitHub Contents設定を削除
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteGitHubContentsConfig();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete GitHub Contents config:", error);
    return NextResponse.json(
      { error: "Failed to delete GitHub Contents config" },
      { status: 500 }
    );
  }
}
