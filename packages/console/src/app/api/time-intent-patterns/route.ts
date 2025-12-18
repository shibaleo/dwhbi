import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAllPatterns, createPatternGroup, getAllProjects } from "@/lib/patterns";

/**
 * GET /api/time-intent-patterns
 * Get all pattern groups with their current versions
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeProjects = request.nextUrl.searchParams.get("includeProjects") === "true";

  try {
    const patterns = await getAllPatterns();

    if (includeProjects) {
      const projects = await getAllProjects();
      return NextResponse.json({ patterns, projects });
    }

    return NextResponse.json({ patterns });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to get patterns:", message, error);
    return NextResponse.json(
      { error: `Failed to get patterns: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/time-intent-patterns
 * Create a new pattern group
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const result = await createPatternGroup(name, description);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to create pattern group" },
        { status: 400 }
      );
    }

    return NextResponse.json({ groupId: result.groupId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to create pattern group:", message, error);
    return NextResponse.json(
      { error: `Failed to create pattern group: ${message}` },
      { status: 500 }
    );
  }
}
