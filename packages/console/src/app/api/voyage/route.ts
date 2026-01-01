import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getVoyageConfig, saveVoyageConfig, deleteVoyageConfig } from "@/lib/vault";

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

/**
 * Voyage AI APIキーの有効性を確認
 */
async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // 簡単なテストリクエストでAPIキーを検証
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: ["test"],
        model: "voyage-3-lite",
      }),
    });

    if (res.status === 401) {
      return { valid: false, error: "APIキーが無効です" };
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { valid: false, error: data.detail || "APIエラーが発生しました" };
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
    const config = await getVoyageConfig();

    if (!config) {
      return NextResponse.json({ configured: false });
    }

    return NextResponse.json({
      configured: true,
      api_key: maskApiKey(config.api_key),
    });
  } catch (error) {
    console.error("Failed to get Voyage config:", error);
    return NextResponse.json(
      { error: "Failed to get Voyage config" },
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
    const { api_key } = body;

    if (!api_key) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    // APIキーの有効性を検証
    const validation = await validateApiKey(api_key);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    await saveVoyageConfig({ api_key });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save Voyage config:", error);
    return NextResponse.json(
      { error: "Failed to save Voyage config" },
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
    await deleteVoyageConfig();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete Voyage config:", error);
    return NextResponse.json(
      { error: "Failed to delete Voyage config" },
      { status: 500 }
    );
  }
}
