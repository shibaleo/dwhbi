import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const supabase = await createClient();

    // 現在のユーザーを取得
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log("[setup/complete] user:", user?.id, user?.email);
    console.log("[setup/complete] authError:", authError);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized", detail: authError?.message }, { status: 401 });
    }

    console.log("[setup/complete] Updating profile for user:", user.id);

    // RLS により自分自身のプロファイルのみ更新可能
    // まず既存のプロファイルを確認
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (existingProfile) {
      // 既存プロファイルを更新
      const { error } = await supabase
        .from("profiles")
        .update({ setup_completed: true })
        .eq("id", user.id);

      console.log("[setup/complete] Update error:", error);

      if (error) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
      }
    } else {
      // プロファイルが存在しない場合は作成
      // is_owner は DB トリガーで自動設定される（最初のユーザーがオーナー）
      console.log("[setup/complete] No profile found, creating new one");
      const { error: insertError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email: user.email,
          setup_completed: true,
        });

      if (insertError) {
        console.log("[setup/complete] Insert error:", insertError);
        return NextResponse.json({ error: insertError.message, code: insertError.code }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[setup/complete] Unexpected error:", e);
    return NextResponse.json({ error: "Internal server error", detail: String(e) }, { status: 500 });
  }
}
