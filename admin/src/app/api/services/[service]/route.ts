import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getServiceCredentials,
  saveServiceCredentials,
  deleteServiceCredentials,
  SERVICES,
  type ServiceName,
} from "@/lib/vault";

type Params = Promise<{ service: string }>;

// サービスの認証情報を取得（マスク済み）
export async function GET(
  request: Request,
  { params }: { params: Params }
) {
  const { service } = await params;

  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // サービス名の検証
  if (!SERVICES.includes(service as ServiceName)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }

  try {
    const credentials = await getServiceCredentials(service as ServiceName);

    if (!credentials) {
      return NextResponse.json({ connected: false, credentials: null });
    }

    // 認証情報をマスク
    const maskedCredentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value === "string" && value.length > 8) {
        maskedCredentials[key] = value.slice(0, 4) + "..." + value.slice(-4);
      } else if (typeof value === "string") {
        maskedCredentials[key] = "****";
      } else {
        maskedCredentials[key] = String(value);
      }
    }

    return NextResponse.json({
      connected: true,
      credentials: maskedCredentials,
    });
  } catch (error) {
    console.error("Failed to get service credentials:", error);
    return NextResponse.json(
      { error: "Failed to get service credentials" },
      { status: 500 }
    );
  }
}

// サービスの認証情報を保存
export async function POST(
  request: Request,
  { params }: { params: Params }
) {
  const { service } = await params;

  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // サービス名の検証
  if (!SERVICES.includes(service as ServiceName)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { credentials, expiresAt } = body;

    if (!credentials || typeof credentials !== "object") {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 400 }
      );
    }

    await saveServiceCredentials(
      service as ServiceName,
      credentials,
      expiresAt || null
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save service credentials:", error);
    return NextResponse.json(
      { error: "Failed to save service credentials" },
      { status: 500 }
    );
  }
}

// サービスの認証情報を削除
export async function DELETE(
  request: Request,
  { params }: { params: Params }
) {
  const { service } = await params;

  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // サービス名の検証
  if (!SERVICES.includes(service as ServiceName)) {
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  }

  try {
    await deleteServiceCredentials(service as ServiceName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete service credentials:", error);
    return NextResponse.json(
      { error: "Failed to delete service credentials" },
      { status: 500 }
    );
  }
}
