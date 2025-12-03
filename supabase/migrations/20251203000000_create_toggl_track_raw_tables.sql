-- Toggl Track Raw Tables Migration
-- Purpose: Store raw API responses from Toggl Track for long-term data preservation
-- Structure: JSONB storage with source_id for upsert/deduplication

-- Create raw schema if not exists
CREATE SCHEMA IF NOT EXISTS raw;

-- ============================================================================
-- Time Entries (Track API v9) - 日次同期用
-- ============================================================================
CREATE TABLE raw.toggl_track__time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__time_entries IS 'Toggl Track API v9 time entries for daily sync';
COMMENT ON COLUMN raw.toggl_track__time_entries.source_id IS 'Unique identifier from API response (time entry id)';
COMMENT ON COLUMN raw.toggl_track__time_entries.data IS 'Raw JSON response from Toggl Track API';
COMMENT ON COLUMN raw.toggl_track__time_entries.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_toggl_track__time_entries_synced_at
    ON raw.toggl_track__time_entries (synced_at);
CREATE INDEX idx_toggl_track__time_entries_data_gin
    ON raw.toggl_track__time_entries USING gin (data);

-- ============================================================================
-- Time Entries Report (Reports API v3) - 全件取得用
-- ============================================================================
CREATE TABLE raw.toggl_track__time_entries_report (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v3'
);

COMMENT ON TABLE raw.toggl_track__time_entries_report IS 'Toggl Reports API v3 time entries for full historical data';
COMMENT ON COLUMN raw.toggl_track__time_entries_report.source_id IS 'Unique identifier from API response (time entry id)';
COMMENT ON COLUMN raw.toggl_track__time_entries_report.data IS 'Raw JSON response from Toggl Reports API';
COMMENT ON COLUMN raw.toggl_track__time_entries_report.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_toggl_track__time_entries_report_synced_at
    ON raw.toggl_track__time_entries_report (synced_at);
CREATE INDEX idx_toggl_track__time_entries_report_data_gin
    ON raw.toggl_track__time_entries_report USING gin (data);

-- ============================================================================
-- Projects
-- ============================================================================
CREATE TABLE raw.toggl_track__projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__projects IS 'Toggl Track projects';
COMMENT ON COLUMN raw.toggl_track__projects.source_id IS 'Unique identifier from API response (project id)';

CREATE INDEX idx_toggl_track__projects_synced_at
    ON raw.toggl_track__projects (synced_at);
CREATE INDEX idx_toggl_track__projects_data_gin
    ON raw.toggl_track__projects USING gin (data);

-- ============================================================================
-- Clients
-- ============================================================================
CREATE TABLE raw.toggl_track__clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__clients IS 'Toggl Track clients';
COMMENT ON COLUMN raw.toggl_track__clients.source_id IS 'Unique identifier from API response (client id)';

CREATE INDEX idx_toggl_track__clients_synced_at
    ON raw.toggl_track__clients (synced_at);
CREATE INDEX idx_toggl_track__clients_data_gin
    ON raw.toggl_track__clients USING gin (data);

-- ============================================================================
-- Tags
-- ============================================================================
CREATE TABLE raw.toggl_track__tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__tags IS 'Toggl Track tags';
COMMENT ON COLUMN raw.toggl_track__tags.source_id IS 'Unique identifier from API response (tag id)';

CREATE INDEX idx_toggl_track__tags_synced_at
    ON raw.toggl_track__tags (synced_at);
CREATE INDEX idx_toggl_track__tags_data_gin
    ON raw.toggl_track__tags USING gin (data);

-- ============================================================================
-- Me (Current User Profile)
-- ============================================================================
CREATE TABLE raw.toggl_track__me (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__me IS 'Toggl Track current user profile';
COMMENT ON COLUMN raw.toggl_track__me.source_id IS 'Unique identifier from API response (user id)';

CREATE INDEX idx_toggl_track__me_synced_at
    ON raw.toggl_track__me (synced_at);
CREATE INDEX idx_toggl_track__me_data_gin
    ON raw.toggl_track__me USING gin (data);

-- ============================================================================
-- Workspaces
-- ============================================================================
CREATE TABLE raw.toggl_track__workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__workspaces IS 'Toggl Track workspaces';
COMMENT ON COLUMN raw.toggl_track__workspaces.source_id IS 'Unique identifier from API response (workspace id)';

CREATE INDEX idx_toggl_track__workspaces_synced_at
    ON raw.toggl_track__workspaces (synced_at);
CREATE INDEX idx_toggl_track__workspaces_data_gin
    ON raw.toggl_track__workspaces USING gin (data);

-- ============================================================================
-- Users (Workspace Members)
-- ============================================================================
CREATE TABLE raw.toggl_track__users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__users IS 'Toggl Track workspace users/members';
COMMENT ON COLUMN raw.toggl_track__users.source_id IS 'Unique identifier from API response (user id)';

CREATE INDEX idx_toggl_track__users_synced_at
    ON raw.toggl_track__users (synced_at);
CREATE INDEX idx_toggl_track__users_data_gin
    ON raw.toggl_track__users USING gin (data);

-- ============================================================================
-- Groups (Workspace Groups)
-- ============================================================================
CREATE TABLE raw.toggl_track__groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

COMMENT ON TABLE raw.toggl_track__groups IS 'Toggl Track workspace groups';
COMMENT ON COLUMN raw.toggl_track__groups.source_id IS 'Unique identifier from API response (group id)';

CREATE INDEX idx_toggl_track__groups_synced_at
    ON raw.toggl_track__groups (synced_at);
CREATE INDEX idx_toggl_track__groups_data_gin
    ON raw.toggl_track__groups USING gin (data);

-- ============================================================================
-- RLS (Row Level Security) 設定
-- raw層はサービスロールのみアクセス可能
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE raw.toggl_track__time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__time_entries_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__me ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__users ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_track__groups ENABLE ROW LEVEL SECURITY;

-- Service role bypass policy (サービスロールは全操作可能)
CREATE POLICY "Service role has full access to toggl_track__time_entries"
    ON raw.toggl_track__time_entries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__time_entries_report"
    ON raw.toggl_track__time_entries_report
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__projects"
    ON raw.toggl_track__projects
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__clients"
    ON raw.toggl_track__clients
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__tags"
    ON raw.toggl_track__tags
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__me"
    ON raw.toggl_track__me
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__workspaces"
    ON raw.toggl_track__workspaces
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__users"
    ON raw.toggl_track__users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to toggl_track__groups"
    ON raw.toggl_track__groups
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
