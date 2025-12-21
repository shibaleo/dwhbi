import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  // セットアップ完了済みのオーナーがいるか確認
  // RLS により認証済みユーザーは自分のプロファイルのみ読める
  // ただし、セットアップ状態の確認は認証前に呼ばれる可能性があるため
  // anon でもアクセス可能な RPC 関数を使用するか、別の方法が必要

  // 現在のユーザーを取得
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // 未認証の場合、セットアップが必要かどうかは判断できない
    // ログインページにリダイレクトさせる
    return NextResponse.json({ needsSetup: false, needsLogin: true });
  }

  // 認証済みユーザーの場合、自分のプロファイルを確認
  const { data, error } = await supabase
    .from("profiles")
    .select("id, is_owner, setup_completed")
    .eq("id", user.id)
    .single();

  if (error) {
    // プロファイルが存在しない場合はセットアップが必要
    return NextResponse.json({ needsSetup: true });
  }

  const isSetupComplete = data?.is_owner && data?.setup_completed;

  return NextResponse.json({
    needsSetup: !isSetupComplete,
    hasOwner: data?.is_owner || false,
  });
}
