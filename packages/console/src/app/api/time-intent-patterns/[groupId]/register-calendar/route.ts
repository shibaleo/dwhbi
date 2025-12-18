import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getPattern,
  getProjectGcalColorMappings,
  type PatternEntry,
} from "@/lib/patterns";
import {
  createEvents,
  type CreateEventInput,
} from "@repo/connector/google-calendar/create-events";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

interface RegisterRequest {
  date: string; // YYYY-MM-DD format
}

interface RegisterResult {
  success: boolean;
  created: number;
  failed: number;
  events?: {
    summary: string;
    startTime: string;
    endTime: string;
    colorId?: string;
  }[];
  errors?: string[];
}

/**
 * Convert pattern entries to Google Calendar events
 * - End time = next entry's start time
 * - Last entry ends at first entry's start time (next day)
 */
function convertToEvents(
  entries: PatternEntry[],
  date: string,
  colorMappings: Map<string, string>
): CreateEventInput[] {
  if (entries.length === 0) return [];

  // Sort by start time
  const sorted = [...entries].sort((a, b) => a.startTime.localeCompare(b.startTime));

  const events: CreateEventInput[] = [];
  const timezone = "+09:00"; // JST

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const nextEntry = sorted[(i + 1) % sorted.length];

    // Start time for this entry
    const startTime = entry.startTime.slice(0, 5); // HH:MM
    const startDateTime = `${date}T${startTime}:00${timezone}`;

    // End time: next entry's start time
    let endDateTime: string;
    if (i === sorted.length - 1) {
      // Last entry ends at first entry's start time on next day
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().slice(0, 10);
      const endTime = nextEntry.startTime.slice(0, 5);
      endDateTime = `${nextDayStr}T${endTime}:00${timezone}`;
    } else {
      const endTime = nextEntry.startTime.slice(0, 5);
      endDateTime = `${date}T${endTime}:00${timezone}`;
    }

    // Get color ID from mapping
    const colorId = colorMappings.get(entry.projectName);

    events.push({
      summary: entry.projectName,
      description: `project_id: ${entry.projectId}`,
      startDateTime,
      endDateTime,
      colorId,
    });
  }

  return events;
}

/**
 * POST /api/time-intent-patterns/[groupId]/register-calendar
 * Register pattern entries as Google Calendar events
 * Body: { date: "YYYY-MM-DD" }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const body = await request.json() as RegisterRequest;
    const { date } = body;

    // Validate date format
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // Get pattern
    const pattern = await getPattern(groupId);
    if (!pattern) {
      return NextResponse.json(
        { error: "Pattern not found" },
        { status: 404 }
      );
    }

    if (pattern.entries.length === 0) {
      return NextResponse.json(
        { error: "Pattern has no entries" },
        { status: 400 }
      );
    }

    // Get color mappings
    const colorMappings = await getProjectGcalColorMappings();

    // Convert to events
    const eventInputs = convertToEvents(pattern.entries, date, colorMappings);

    // Create events in Google Calendar
    const { created, failed } = await createEvents(eventInputs);

    const result: RegisterResult = {
      success: failed.length === 0,
      created: created.length,
      failed: failed.length,
      events: created.map(e => ({
        summary: e.summary,
        startTime: e.start.dateTime,
        endTime: e.end.dateTime,
      })),
      errors: failed.map(f => `${f.event.summary}: ${f.error}`),
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to register calendar events:", message, error);
    return NextResponse.json(
      { error: `Failed to register calendar events: ${message}` },
      { status: 500 }
    );
  }
}
