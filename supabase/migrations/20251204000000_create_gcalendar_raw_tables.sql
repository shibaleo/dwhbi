-- Google Calendar Raw Tables Migration
-- Purpose: Store raw API responses from Google Calendar API v3 for long-term data preservation
-- Structure: JSONB storage with source_id for upsert/deduplication

-- Create raw schema if not exists
CREATE SCHEMA IF NOT EXISTS raw;

-- ============================================================================
-- Events
-- ============================================================================
CREATE TABLE raw.google_calendar__events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v3'
);

COMMENT ON TABLE raw.google_calendar__events IS 'Google Calendar API v3 events';
COMMENT ON COLUMN raw.google_calendar__events.source_id IS 'Unique identifier: {calendarId}:{eventId}';
COMMENT ON COLUMN raw.google_calendar__events.data IS 'Raw JSON response from Google Calendar Events API';
COMMENT ON COLUMN raw.google_calendar__events.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_google_calendar__events_synced_at
    ON raw.google_calendar__events (synced_at);
CREATE INDEX idx_google_calendar__events_data_gin
    ON raw.google_calendar__events USING gin (data);

-- ============================================================================
-- Colors (Event and Calendar color palette)
-- ============================================================================
CREATE TABLE raw.google_calendar__colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v3'
);

COMMENT ON TABLE raw.google_calendar__colors IS 'Google Calendar API v3 color definitions';
COMMENT ON COLUMN raw.google_calendar__colors.source_id IS 'Color type: "event" or "calendar"';
COMMENT ON COLUMN raw.google_calendar__colors.data IS 'Raw JSON response from Google Calendar Colors API';
COMMENT ON COLUMN raw.google_calendar__colors.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_google_calendar__colors_synced_at
    ON raw.google_calendar__colors (synced_at);
CREATE INDEX idx_google_calendar__colors_data_gin
    ON raw.google_calendar__colors USING gin (data);

-- ============================================================================
-- CalendarList (User's calendar subscriptions)
-- ============================================================================
CREATE TABLE raw.google_calendar__calendar_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v3'
);

COMMENT ON TABLE raw.google_calendar__calendar_list IS 'Google Calendar API v3 calendar list entries';
COMMENT ON COLUMN raw.google_calendar__calendar_list.source_id IS 'Unique identifier from API response (calendar id)';
COMMENT ON COLUMN raw.google_calendar__calendar_list.data IS 'Raw JSON response from Google Calendar CalendarList API';
COMMENT ON COLUMN raw.google_calendar__calendar_list.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_google_calendar__calendar_list_synced_at
    ON raw.google_calendar__calendar_list (synced_at);
CREATE INDEX idx_google_calendar__calendar_list_data_gin
    ON raw.google_calendar__calendar_list USING gin (data);

-- ============================================================================
-- Calendars (Calendar metadata)
-- ============================================================================
CREATE TABLE raw.google_calendar__calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v3'
);

COMMENT ON TABLE raw.google_calendar__calendars IS 'Google Calendar API v3 calendar metadata';
COMMENT ON COLUMN raw.google_calendar__calendars.source_id IS 'Unique identifier from API response (calendar id)';
COMMENT ON COLUMN raw.google_calendar__calendars.data IS 'Raw JSON response from Google Calendar Calendars API';
COMMENT ON COLUMN raw.google_calendar__calendars.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_google_calendar__calendars_synced_at
    ON raw.google_calendar__calendars (synced_at);
CREATE INDEX idx_google_calendar__calendars_data_gin
    ON raw.google_calendar__calendars USING gin (data);

-- ============================================================================
-- RLS (Row Level Security) 設定
-- raw層はサービスロールのみアクセス可能
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE raw.google_calendar__events ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.google_calendar__colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.google_calendar__calendar_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.google_calendar__calendars ENABLE ROW LEVEL SECURITY;

-- Service role bypass policy (サービスロールは全操作可能)
CREATE POLICY "Service role has full access to google_calendar__events"
    ON raw.google_calendar__events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to google_calendar__colors"
    ON raw.google_calendar__colors
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to google_calendar__calendar_list"
    ON raw.google_calendar__calendar_list
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to google_calendar__calendars"
    ON raw.google_calendar__calendars
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Drop old tables (既存テーブルを削除)
-- ============================================================================
DROP TABLE IF EXISTS raw.gcalendar_events;
DROP TABLE IF EXISTS raw.gcalendar__events;
DROP TABLE IF EXISTS raw.gcalendar__colors;
DROP TABLE IF EXISTS raw.gcalendar__calendar_list;
