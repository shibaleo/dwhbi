-- Coda Master & Mapping Tables Migration
-- Purpose: Store raw API responses from Coda master and mapping tables
-- Structure: JSONB storage with source_id (row_id) for upsert/deduplication

-- ============================================================================
-- Master: Personal Time Category
-- ============================================================================
CREATE TABLE raw.coda__mst_personal_time_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__mst_personal_time_category IS 'Coda mst_personal_time_category table rows';
COMMENT ON COLUMN raw.coda__mst_personal_time_category.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__mst_personal_time_category.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__mst_personal_time_category_synced_at
    ON raw.coda__mst_personal_time_category (synced_at);
CREATE INDEX idx_coda__mst_personal_time_category_data_gin
    ON raw.coda__mst_personal_time_category USING gin (data);

-- ============================================================================
-- Master: Social Time Category
-- ============================================================================
CREATE TABLE raw.coda__mst_social_time_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__mst_social_time_category IS 'Coda mst_social_time_category table rows';
COMMENT ON COLUMN raw.coda__mst_social_time_category.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__mst_social_time_category.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__mst_social_time_category_synced_at
    ON raw.coda__mst_social_time_category (synced_at);
CREATE INDEX idx_coda__mst_social_time_category_data_gin
    ON raw.coda__mst_social_time_category USING gin (data);

-- ============================================================================
-- Master: Toggl Projects
-- ============================================================================
CREATE TABLE raw.coda__mst_toggl_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__mst_toggl_projects IS 'Coda mst_toggl_projects table rows';
COMMENT ON COLUMN raw.coda__mst_toggl_projects.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__mst_toggl_projects.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__mst_toggl_projects_synced_at
    ON raw.coda__mst_toggl_projects (synced_at);
CREATE INDEX idx_coda__mst_toggl_projects_data_gin
    ON raw.coda__mst_toggl_projects USING gin (data);

-- ============================================================================
-- Mapping: Toggl Color to Personal Time Category
-- ============================================================================
CREATE TABLE raw.coda__map_toggl_color_to_personal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__map_toggl_color_to_personal IS 'Coda map_toggl_color_to_personal_time_category table rows';
COMMENT ON COLUMN raw.coda__map_toggl_color_to_personal.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__map_toggl_color_to_personal.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__map_toggl_color_to_personal_synced_at
    ON raw.coda__map_toggl_color_to_personal (synced_at);
CREATE INDEX idx_coda__map_toggl_color_to_personal_data_gin
    ON raw.coda__map_toggl_color_to_personal USING gin (data);

-- ============================================================================
-- Mapping: Toggl Client to Social Time Category
-- ============================================================================
CREATE TABLE raw.coda__map_toggl_client_to_social (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__map_toggl_client_to_social IS 'Coda map_toggl_client_to_social_time_category table rows';
COMMENT ON COLUMN raw.coda__map_toggl_client_to_social.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__map_toggl_client_to_social.data IS 'Raw JSON response from Coda API';

CREATE INDEX idx_coda__map_toggl_client_to_social_synced_at
    ON raw.coda__map_toggl_client_to_social (synced_at);
CREATE INDEX idx_coda__map_toggl_client_to_social_data_gin
    ON raw.coda__map_toggl_client_to_social USING gin (data);

-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================

ALTER TABLE raw.coda__mst_personal_time_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.coda__mst_social_time_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.coda__mst_toggl_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.coda__map_toggl_color_to_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.coda__map_toggl_client_to_social ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to coda__mst_personal_time_category"
    ON raw.coda__mst_personal_time_category
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to coda__mst_social_time_category"
    ON raw.coda__mst_social_time_category
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to coda__mst_toggl_projects"
    ON raw.coda__mst_toggl_projects
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to coda__map_toggl_color_to_personal"
    ON raw.coda__map_toggl_color_to_personal
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to coda__map_toggl_client_to_social"
    ON raw.coda__map_toggl_client_to_social
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
