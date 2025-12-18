import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPattern, type PatternEntry } from "@/lib/patterns";
import {
  createEvents,
  type CreateEventInput,
} from "@repo/connector/google-calendar/create-events";

// Toggl color hex -> GCal colorId (static mapping, no DB query needed)
// GCal colors: 1=Lavender, 2=Sage, 3=Grape, 4=Flamingo, 5=Banana, 6=Tangerine, 7=Peacock, 8=Graphite, 9=Blueberry, 10=Basil, 11=Tomato
const TOGGL_HEX_TO_GCAL_COLOR: Record<string, string> = {
  "#0b83d9": "7",  // Peacock
  "#2da608": "10",
  "#465bb3": "9",  // Blueberry
  "#990099": "3",
  "#9e5bd9": "1",
  "#c7af14": "5",
  "#c9806b": "4",
  "#d92b2b": "11",
  "#d94182": "3",
  "#e36a00": "6",
};

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

interface RegisterRequest {
  date?: string; // YYYY-MM-DD format (single date, for backward compatibility)
  dates?: string[]; // Array of YYYY-MM-DD (multiple dates)
}

interface RegisterResult {
  success: boolean;
  created: number;
  failed: number;
  dateResults?: {
    date: string;
    created: number;
    failed: number;
  }[];
  errors?: string[];
}

/**
 * Convert pattern entries to Google Calendar events
 * - End time = next entry's start time
 * - Last entry ends at first entry's start time (next day)
 * - Color is derived from entry.projectColor (Toggl hex) using static mapping
 */
function convertToEvents(
  entries: PatternEntry[],
  date: string,
  groupId: string
): CreateEventInput[] {
  if (entries.length === 0) return [];

  // Sort by start time
  const sorted = [...entries].sort((a, b) => a.startTime.localeCompare(b.startTime));

  const events: CreateEventInput[] = [];
  const timezone = "+09:00"; // JST
  const registeredAt = new Date().toISOString();

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

    // Get color ID from Toggl hex using static mapping
    const colorId = entry.projectColor
      ? TOGGL_HEX_TO_GCAL_COLOR[entry.projectColor]
      : undefined;

    events.push({
      summary: entry.projectName,
      startDateTime,
      endDateTime,
      colorId,
      extendedProperties: {
        source: "dwhbi-console",
        toggl_track_project_id: entry.projectId,
        pattern_group_id: groupId,
        registered_at: registeredAt,
        tags: [],
      },
    });
  }

  return events;
}

/**
 * POST /api/time-intent-patterns/[groupId]/register-calendar
 * Register pattern entries as Google Calendar events
 * Body: { date: "YYYY-MM-DD" } or { dates: ["YYYY-MM-DD", ...] }
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

    // Support both single date and multiple dates
    const dates: string[] = body.dates || (body.date ? [body.date] : []);

    // Validate dates
    if (dates.length === 0) {
      return NextResponse.json(
        { error: "No dates provided. Use 'date' or 'dates' field." },
        { status: 400 }
      );
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const invalidDates = dates.filter(d => !datePattern.test(d));
    if (invalidDates.length > 0) {
      return NextResponse.json(
        { error: `Invalid date format: ${invalidDates.join(", ")}. Use YYYY-MM-DD` },
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

    // Convert to events for all dates (color mapping uses static lookup, no DB query)
    const allEventInputs: CreateEventInput[] = [];
    for (const date of dates) {
      const eventInputs = convertToEvents(pattern.entries, date, groupId);
      allEventInputs.push(...eventInputs);
    }

    // Create events in Google Calendar
    const { created, failed } = await createEvents(allEventInputs);

    // Calculate per-date results
    const entriesPerDay = pattern.entries.length;
    const dateResults = dates.map((date, i) => {
      const startIdx = i * entriesPerDay;
      const endIdx = startIdx + entriesPerDay;
      const dateCreated = created.filter(e =>
        e.start.dateTime.startsWith(date)
      ).length;
      const dateFailed = failed.filter(f =>
        f.event.startDateTime.startsWith(date)
      ).length;
      return { date, created: dateCreated, failed: dateFailed };
    });

    const result: RegisterResult = {
      success: failed.length === 0,
      created: created.length,
      failed: failed.length,
      dateResults,
      errors: failed.length > 0 ? failed.map(f => `${f.event.summary}: ${f.error}`) : undefined,
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
