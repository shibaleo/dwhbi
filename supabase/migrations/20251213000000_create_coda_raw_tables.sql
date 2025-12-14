-- Coda Raw Tables Migration
-- Purpose: Store raw API responses from Coda for long-term data preservation
-- Structure: JSONB storage with source_id for upsert/deduplication

-- Create raw schema if not exists
CREATE SCHEMA IF NOT EXISTS raw;

-- ============================================================================
-- Table Rows (Coda API v1)
-- source_id format: {doc_id}:{table_id}:{row_id}
-- ============================================================================
CREATE TABLE raw.coda__table_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__table_rows IS 'Coda API v1 table rows';
COMMENT ON COLUMN raw.coda__table_rows.source_id IS 'Unique identifier: {doc_id}:{table_id}:{row_id}';
COMMENT ON COLUMN raw.coda__table_rows.data IS 'Raw JSON response from Coda API including row values';
COMMENT ON COLUMN raw.coda__table_rows.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_coda__table_rows_synced_at
    ON raw.coda__table_rows (synced_at);
CREATE INDEX idx_coda__table_rows_data_gin
    ON raw.coda__table_rows USING gin (data);

-- ============================================================================
-- RLS (Row Level Security) 設定
-- raw層はサービスロールのみアクセス可能
-- ============================================================================

ALTER TABLE raw.coda__table_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to coda__table_rows"
    ON raw.coda__table_rows
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
