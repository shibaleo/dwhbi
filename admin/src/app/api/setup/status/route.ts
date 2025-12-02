import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  // Service Role で profiles テーブルを確認
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // セットアップ完了済みのオーナーがいるか確認
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_owner", true)
    .eq("setup_completed", true)
    .limit(1);

  if (error) {
    // テーブルが存在しない場合もセットアップ必要
    return NextResponse.json({ needsSetup: true, error: error.message });
  }

  const hasCompletedOwner = data && data.length > 0;

  return NextResponse.json({
    needsSetup: !hasCompletedOwner,
    hasOwner: hasCompletedOwner,
  });
}
