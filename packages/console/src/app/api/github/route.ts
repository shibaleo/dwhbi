import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGitHubConfig, saveGitHubConfig, deleteGitHubConfig } from "@/lib/vault";

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

/**
 * GitHub APIでPATの有効期限を取得
 */
async function fetchPATExpiration(pat: string): Promise<string | null> {
  try {
    // Fine-grained PATの場合、/user エンドポイントで認証確認
    // 有効期限はレスポンスヘッダーには含まれないため、
    // APIが成功するかどうかで有効性を確認
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      return null;
    }

    // Fine-grained PATの有効期限はGitHub APIからは取得できない
    // ユーザーが手動で入力するか、作成時の情報を保存する必要がある
    // ここではAPIが成功したことを確認するのみ
    return null;
  } catch {
    return null;
  }
}

/**
 * GitHub APIでPATの有効性とリポジトリアクセスを確認
 */
async function validatePAT(pat: string, owner: string, repo: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // ユーザー認証確認
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userRes.ok) {
      return { valid: false, error: "PATが無効です" };
    }

    // リポジトリアクセス確認
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!repoRes.ok) {
      return { valid: false, error: `リポジトリ ${owner}/${repo} にアクセスできません` };
    }

    // Actions権限確認（ワークフロー一覧取得）
    const actionsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!actionsRes.ok) {
      return { valid: false, error: "Actions権限がありません" };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: "検証中にエラーが発生しました" };
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = await getGitHubConfig();

    if (!config) {
      return NextResponse.json({ configured: false });
    }

    return NextResponse.json({
      configured: true,
      pat: maskToken(config.pat),
      owner: config.owner,
      repo: config.repo,
      expiresAt: config.expiresAt,
    });
  } catch (error) {
    console.error("Failed to get GitHub config:", error);
    return NextResponse.json(
      { error: "Failed to get GitHub config" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pat, owner, repo, expiresAt } = body;

    if (!pat || !owner || !repo) {
      return NextResponse.json(
        { error: "PAT, owner, and repo are required" },
        { status: 400 }
      );
    }

    // PATの有効性を検証
    const validation = await validatePAT(pat, owner, repo);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    await saveGitHubConfig({ pat, owner, repo, expiresAt: expiresAt || null });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save GitHub config:", error);
    return NextResponse.json(
      { error: "Failed to save GitHub config" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteGitHubConfig();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete GitHub config:", error);
    return NextResponse.json(
      { error: "Failed to delete GitHub config" },
      { status: 500 }
    );
  }
}
