-- Coda Master: Coarse Personal Time Category
-- Purpose: Store raw API responses from Coda mst_coarse_personal_time_category table
-- Structure: JSONB storage with source_id (row_id) for upsert/deduplication

-- ============================================================================
-- Master: Coarse Personal Time Category
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw.coda__mst_coarse_personal_time_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.coda__mst_coarse_personal_time_category IS 'Coda mst_coarse_personal_time_category table rows';
COMMENT ON COLUMN raw.coda__mst_coarse_personal_time_category.source_id IS 'Coda row_id';
COMMENT ON COLUMN raw.coda__mst_coarse_personal_time_category.data IS 'Raw JSON response from Coda API';

CREATE INDEX IF NOT EXISTS idx_coda__mst_coarse_personal_time_category_synced_at
    ON raw.coda__mst_coarse_personal_time_category (synced_at);
CREATE INDEX IF NOT EXISTS idx_coda__mst_coarse_personal_time_category_data_gin
    ON raw.coda__mst_coarse_personal_time_category USING gin (data);

-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================

ALTER TABLE raw.coda__mst_coarse_personal_time_category ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to coda__mst_coarse_personal_time_category"
    ON raw.coda__mst_coarse_personal_time_category
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
