import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getPattern,
  getVersionHistory,
  updatePatternGroup,
  createVersion,
  deletePatternGroup,
} from "@/lib/patterns";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

/**
 * GET /api/time-intent-patterns/[groupId]
 * Get a single pattern with version history
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const pattern = await getPattern(groupId);

    if (!pattern) {
      return NextResponse.json(
        { error: "Pattern not found" },
        { status: 404 }
      );
    }

    const history = await getVersionHistory(groupId);

    return NextResponse.json({ pattern, history });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to get pattern:", message, error);
    return NextResponse.json(
      { error: `Failed to get pattern: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/time-intent-patterns/[groupId]
 * Update pattern group name/description
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const result = await updatePatternGroup(groupId, name, description);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to update pattern group" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to update pattern group:", message, error);
    return NextResponse.json(
      { error: `Failed to update pattern group: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/time-intent-patterns/[groupId]
 * Create a new version
 * Body: { versionNumber: string, entries: PatternEntry[] }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const body = await request.json();
    const { versionNumber, entries, message } = body;

    if (!versionNumber || typeof versionNumber !== "string") {
      return NextResponse.json(
        { error: "versionNumber is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(entries)) {
      return NextResponse.json(
        { error: "entries must be an array" },
        { status: 400 }
      );
    }

    const result = await createVersion(groupId, versionNumber, entries, message);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to create version" },
        { status: 400 }
      );
    }

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to create version:", message, error);
    return NextResponse.json(
      { error: `Failed to create version: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/time-intent-patterns/[groupId]
 * Delete a pattern group and all its versions
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const result = await deletePatternGroup(groupId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to delete pattern group" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to delete pattern group:", message, error);
    return NextResponse.json(
      { error: `Failed to delete pattern group: ${message}` },
      { status: 500 }
    );
  }
}
