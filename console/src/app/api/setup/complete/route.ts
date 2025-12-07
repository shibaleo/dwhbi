import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    // 現在のユーザーを取得
    const supabaseAuth = await createServerClient();
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    console.log("[setup/complete] user:", user?.id, user?.email);
    console.log("[setup/complete] authError:", authError);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized", detail: authError?.message }, { status: 401 });
    }

    // Service Role で setup_completed を更新
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log("[setup/complete] Updating profile for user:", user.id);

    const { data, error } = await supabase
      .from("profiles")
      .update({ setup_completed: true })
      .eq("id", user.id)
      .select();

    console.log("[setup/complete] Update result - data:", data);
    console.log("[setup/complete] Update result - error:", error);

    if (error) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }

    if (!data || data.length === 0) {
      // プロファイルが存在しない場合は作成
      console.log("[setup/complete] No profile found, creating new one");
      const { error: insertError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email: user.email,
          is_owner: true,
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
