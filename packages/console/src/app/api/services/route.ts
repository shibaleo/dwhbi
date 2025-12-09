import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServicesStatus } from "@/lib/vault";

export async function GET() {
  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const services = await getServicesStatus();
    return NextResponse.json({ services });
  } catch (error) {
    console.error("Failed to get services status:", error);
    return NextResponse.json(
      { error: "Failed to get services status" },
      { status: 500 }
    );
  }
}
