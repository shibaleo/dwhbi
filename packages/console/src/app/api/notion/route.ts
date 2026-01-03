import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNotionConfig, saveNotionConfig, deleteNotionConfig } from "@/lib/vault";

function maskApiToken(token: string): string {
  if (token.length <= 12) return "****";
  return token.slice(0, 8) + "****" + token.slice(-4);
}

/**
 * Notion API Tokenの有効性を確認
 */
async function validateApiToken(apiToken: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // /users/me エンドポイントでトークンを検証
    const res = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (res.status === 401) {
      return { valid: false, error: "APIトークンが無効です" };
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { valid: false, error: data.message || "APIエラーが発生しました" };
    }

    return { valid: true };
  } catch {
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
    const config = await getNotionConfig();

    if (!config) {
      return NextResponse.json({ configured: false });
    }

    return NextResponse.json({
      configured: true,
      api_token: maskApiToken(config.api_token),
    });
  } catch (error) {
    console.error("Failed to get Notion config:", error);
    return NextResponse.json(
      { error: "Failed to get Notion config" },
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
    const { api_token } = body;

    if (!api_token) {
      return NextResponse.json(
        { error: "API token is required" },
        { status: 400 }
      );
    }

    // APIトークンの有効性を検証
    const validation = await validateApiToken(api_token);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    await saveNotionConfig({ api_token });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save Notion config:", error);
    return NextResponse.json(
      { error: "Failed to save Notion config" },
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
    await deleteNotionConfig();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete Notion config:", error);
    return NextResponse.json(
      { error: "Failed to delete Notion config" },
      { status: 500 }
    );
  }
}
