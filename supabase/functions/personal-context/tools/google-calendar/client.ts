// Google Calendar API Client for MCP
// Uses OAuth2 tokens stored in Supabase Vault

import { createClient } from "@supabase/supabase-js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, supabaseKey);
}

interface Credentials {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  calendar_id?: string;
  _expires_at?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// Cache
let cachedCredentials: Credentials | null = null;
let cachedExpiresAt: Date | null = null;

async function refreshAccessToken(credentials: Credentials): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh error: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  // Update vault with new token
  const supabase = getSupabaseClient();
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await supabase
    .schema("console")
    .rpc("upsert_service_secret", {
      service_name: "google_calendar",
      secret_data: {
        ...credentials,
        access_token: data.access_token,
        scope: data.scope,
        _expires_at: newExpiresAt.toISOString(),
        _auth_type: "oauth",
      },
      secret_description: "Google Calendar credentials",
    });

  // Update cache
  cachedCredentials = { ...credentials, access_token: data.access_token };
  cachedExpiresAt = newExpiresAt;

  return data.access_token;
}

async function getAccessToken(): Promise<{ accessToken: string; calendarId: string }> {
  const THRESHOLD_MINUTES = 5;

  // Check cache
  if (cachedCredentials && cachedExpiresAt) {
    const minutesUntilExpiry = (cachedExpiresAt.getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > THRESHOLD_MINUTES) {
      return {
        accessToken: cachedCredentials.access_token,
        calendarId: cachedCredentials.calendar_id || "primary",
      };
    }
  }

  // Load from vault
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", { service_name: "google_calendar" });

  if (error || !data) {
    throw new Error("Google Calendar credentials not found in vault");
  }

  const credentials = data as Credentials;

  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Missing client_id or client_secret");
  }
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error("Missing access_token or refresh_token. Run OAuth flow first.");
  }

  // Check if refresh needed
  let accessToken = credentials.access_token;
  let expiresAt = credentials._expires_at ? new Date(credentials._expires_at) : null;

  const needsRefresh = !expiresAt ||
    (expiresAt.getTime() - Date.now()) / 1000 / 60 <= THRESHOLD_MINUTES;

  if (needsRefresh) {
    accessToken = await refreshAccessToken(credentials);
  } else {
    cachedCredentials = credentials;
    cachedExpiresAt = expiresAt;
  }

  return {
    accessToken,
    calendarId: credentials.calendar_id || "primary",
  };
}

export interface CalendarApiError {
  status: number;
  code: string;
  message: string;
}

async function calendarRequest<T>(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  retried = false
): Promise<T> {
  const { accessToken, calendarId: _calendarId } = await getAccessToken();
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${CALENDAR_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Handle token expiry
    if (response.status === 401 && !retried) {
      // Force refresh token
      cachedCredentials = null;
      cachedExpiresAt = null;
      return calendarRequest<T>(method, endpoint, body, true);
    }

    const errorData = await response.json().catch(() => ({}));
    throw {
      status: response.status,
      code: (errorData as { error?: { code?: string } }).error?.code || "unknown_error",
      message: (errorData as { error?: { message?: string } }).error?.message ||
        `Google Calendar API error: ${response.status}`,
    } as CalendarApiError;
  }

  return response.json();
}

// =============================================================================
// Calendars
// =============================================================================

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface CalendarListResponse {
  kind: string;
  items: CalendarListEntry[];
  nextPageToken?: string;
}

export async function listCalendars(): Promise<CalendarListEntry[]> {
  const response = await calendarRequest<CalendarListResponse>(
    "GET",
    "/users/me/calendarList?maxResults=250"
  );
  return response.items || [];
}

// =============================================================================
// Events
// =============================================================================

export interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  status?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  creator?: { email: string; displayName?: string };
  organizer?: { email: string; displayName?: string };
  attendees?: EventAttendee[];
  colorId?: string;
  recurrence?: string[];
  recurringEventId?: string;
}

export interface EventListResponse {
  kind: string;
  items: CalendarEvent[];
  nextPageToken?: string;
  summary?: string;
  timeZone?: string;
}

export interface ListEventsParams {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: "startTime" | "updated";
  q?: string;
  timeZone?: string;
}

export async function listEvents(params: ListEventsParams = {}): Promise<CalendarEvent[]> {
  const { accessToken, calendarId: defaultCalendarId } = await getAccessToken();
  const calendarId = params.calendarId || defaultCalendarId;
  const calendarIdEncoded = encodeURIComponent(calendarId);

  const query = new URLSearchParams();
  if (params.timeMin) query.set("timeMin", params.timeMin);
  if (params.timeMax) query.set("timeMax", params.timeMax);
  if (params.maxResults) query.set("maxResults", params.maxResults.toString());
  if (params.singleEvents !== undefined) query.set("singleEvents", params.singleEvents.toString());
  if (params.orderBy) query.set("orderBy", params.orderBy);
  if (params.q) query.set("q", params.q);
  if (params.timeZone) query.set("timeZone", params.timeZone);

  const allEvents: CalendarEvent[] = [];
  let pageToken: string | undefined;

  while (true) {
    if (pageToken) query.set("pageToken", pageToken);

    const response = await calendarRequest<EventListResponse>(
      "GET",
      `/calendars/${calendarIdEncoded}/events?${query}`
    );

    if (response.items) {
      allEvents.push(...response.items);
    }

    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }

  return allEvents;
}

export async function getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
  const calendarIdEncoded = encodeURIComponent(calendarId);
  const eventIdEncoded = encodeURIComponent(eventId);
  return calendarRequest<CalendarEvent>(
    "GET",
    `/calendars/${calendarIdEncoded}/events/${eventIdEncoded}`
  );
}

export interface CreateEventParams {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: EventAttendee[];
  colorId?: string;
  recurrence?: string[];
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
  sendUpdates?: "all" | "externalOnly" | "none";
}

export async function createEvent(params: CreateEventParams): Promise<CalendarEvent> {
  const { calendarId: defaultCalendarId } = await getAccessToken();
  const calendarId = params.calendarId || defaultCalendarId;
  const calendarIdEncoded = encodeURIComponent(calendarId);

  const query = new URLSearchParams();
  if (params.sendUpdates) query.set("sendUpdates", params.sendUpdates);

  const body: Record<string, unknown> = {
    summary: params.summary,
    start: params.start,
    end: params.end,
  };
  if (params.description) body.description = params.description;
  if (params.location) body.location = params.location;
  if (params.attendees) body.attendees = params.attendees;
  if (params.colorId) body.colorId = params.colorId;
  if (params.recurrence) body.recurrence = params.recurrence;
  if (params.reminders) body.reminders = params.reminders;

  return calendarRequest<CalendarEvent>(
    "POST",
    `/calendars/${calendarIdEncoded}/events?${query}`,
    body
  );
}

export interface UpdateEventParams {
  calendarId: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  attendees?: EventAttendee[];
  colorId?: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export async function updateEvent(params: UpdateEventParams): Promise<CalendarEvent> {
  const calendarIdEncoded = encodeURIComponent(params.calendarId);
  const eventIdEncoded = encodeURIComponent(params.eventId);

  const query = new URLSearchParams();
  if (params.sendUpdates) query.set("sendUpdates", params.sendUpdates);

  const body: Record<string, unknown> = {};
  if (params.summary !== undefined) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.location !== undefined) body.location = params.location;
  if (params.start !== undefined) body.start = params.start;
  if (params.end !== undefined) body.end = params.end;
  if (params.attendees !== undefined) body.attendees = params.attendees;
  if (params.colorId !== undefined) body.colorId = params.colorId;

  return calendarRequest<CalendarEvent>(
    "PATCH",
    `/calendars/${calendarIdEncoded}/events/${eventIdEncoded}?${query}`,
    body
  );
}

export interface DeleteEventParams {
  calendarId: string;
  eventId: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export async function deleteEvent(params: DeleteEventParams): Promise<void> {
  const calendarIdEncoded = encodeURIComponent(params.calendarId);
  const eventIdEncoded = encodeURIComponent(params.eventId);

  const query = new URLSearchParams();
  if (params.sendUpdates) query.set("sendUpdates", params.sendUpdates);

  const { accessToken } = await getAccessToken();
  const url = `${CALENDAR_API_BASE}/calendars/${calendarIdEncoded}/events/${eventIdEncoded}?${query}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 204) {
    const errorData = await response.json().catch(() => ({}));
    throw {
      status: response.status,
      code: (errorData as { error?: { code?: string } }).error?.code || "unknown_error",
      message: (errorData as { error?: { message?: string } }).error?.message ||
        `Delete event error: ${response.status}`,
    } as CalendarApiError;
  }
}

// =============================================================================
// Free/Busy
// =============================================================================

export interface FreeBusyParams {
  timeMin: string;
  timeMax: string;
  items: Array<{ id: string }>;
  timeZone?: string;
}

export interface FreeBusyResponse {
  kind: string;
  timeMin: string;
  timeMax: string;
  calendars: Record<string, {
    busy: Array<{ start: string; end: string }>;
    errors?: Array<{ domain: string; reason: string }>;
  }>;
}

export async function getFreeBusy(params: FreeBusyParams): Promise<FreeBusyResponse> {
  return calendarRequest<FreeBusyResponse>("POST", "/freeBusy", params);
}

// =============================================================================
// Colors
// =============================================================================

export interface ColorsResponse {
  kind: string;
  updated: string;
  calendar: Record<string, { background: string; foreground: string }>;
  event: Record<string, { background: string; foreground: string }>;
}

export async function getColors(): Promise<ColorsResponse> {
  return calendarRequest<ColorsResponse>("GET", "/colors");
}

// =============================================================================
// Current Time Helper
// =============================================================================

export function getCurrentTime(timeZone?: string): { iso: string; timeZone: string; formatted: string } {
  const tz = timeZone || "Asia/Tokyo";
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";

  const formatted = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;

  return {
    iso: now.toISOString(),
    timeZone: tz,
    formatted,
  };
}
