-- Coda Google Calendar Color Mapping Tables Migration
-- Purpose: Store raw API responses from Coda tables for Toggl Project to GCal color mapping

-- ============================================================================
-- Mapping: Toggl Project to Google Calendar Color
-- ============================================================================
CREATE TABLE raw.coda__map_toggl_project_to_gcal_color (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__map_toggl_project_to_gcal_color IS 'Coda map_toggl_project_to_google_color table rows';
COMMENT ON COLUMN raw.coda__map_toggl_project_to_gcal_color.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__map_toggl_project_to_gcal_color.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__map_toggl_project_to_gcal_color_synced_at
    ON raw.coda__map_toggl_project_to_gcal_color (synced_at);
CREATE INDEX idx_coda__map_toggl_project_to_gcal_color_data_gin
    ON raw.coda__map_toggl_project_to_gcal_color USING gin (data);

-- ============================================================================
-- Master: Google Calendar Colors
-- ============================================================================
CREATE TABLE raw.coda__mst_google_calendar_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__mst_google_calendar_colors IS 'Coda mst_google_calendar_colors table rows';
COMMENT ON COLUMN raw.coda__mst_google_calendar_colors.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__mst_google_calendar_colors.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__mst_google_calendar_colors_synced_at
    ON raw.coda__mst_google_calendar_colors (synced_at);
CREATE INDEX idx_coda__mst_google_calendar_colors_data_gin
    ON raw.coda__mst_google_calendar_colors USING gin (data);

-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================

ALTER TABLE raw.coda__map_toggl_project_to_gcal_color ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.coda__mst_google_calendar_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to coda__map_toggl_project_to_gcal_color"
    ON raw.coda__map_toggl_project_to_gcal_color
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to coda__mst_google_calendar_colors"
    ON raw.coda__mst_google_calendar_colors
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
