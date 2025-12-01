-- ============================================================================
-- Airtable Tables in raw Schema
-- Created: 2025-12-01
-- ============================================================================
--
-- Airtableデータ構造:
--   - bases: ワークスペース内のベース（データベース）
--   - tables: ベース内のテーブル（スキーマ情報含む）
--   - records: テーブル内のレコード（JSONB形式）
--
-- 認証方式: Personal Access Token (PAT)
-- API Base URL: https://api.airtable.com/v0
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- raw.airtable_bases
-- ----------------------------------------------------------------------------
CREATE TABLE raw.airtable_bases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    permission_level TEXT DEFAULT 'read',
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.airtable_bases IS 'Airtableベース（生データ）';
COMMENT ON COLUMN raw.airtable_bases.id IS 'Airtable Base ID (appXXX)';
COMMENT ON COLUMN raw.airtable_bases.name IS 'ベース名';
COMMENT ON COLUMN raw.airtable_bases.permission_level IS '権限レベル (read/comment/edit/create)';

-- ----------------------------------------------------------------------------
-- raw.airtable_tables
-- ----------------------------------------------------------------------------
CREATE TABLE raw.airtable_tables (
    id TEXT PRIMARY KEY,
    base_id TEXT NOT NULL REFERENCES raw.airtable_bases(id),
    name TEXT NOT NULL,
    primary_field_id TEXT,
    fields JSONB,
    views JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.airtable_tables IS 'Airtableテーブル（生データ）';
COMMENT ON COLUMN raw.airtable_tables.id IS 'Airtable Table ID (tblXXX)';
COMMENT ON COLUMN raw.airtable_tables.base_id IS '所属ベースID';
COMMENT ON COLUMN raw.airtable_tables.name IS 'テーブル名';
COMMENT ON COLUMN raw.airtable_tables.primary_field_id IS 'プライマリフィールドID';
COMMENT ON COLUMN raw.airtable_tables.fields IS 'フィールド定義（スキーマ）';
COMMENT ON COLUMN raw.airtable_tables.views IS 'ビュー定義';

-- ----------------------------------------------------------------------------
-- raw.airtable_records
-- ----------------------------------------------------------------------------
CREATE TABLE raw.airtable_records (
    id TEXT PRIMARY KEY,
    base_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    created_time TIMESTAMPTZ NOT NULL,
    fields JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.airtable_records IS 'Airtableレコード（生データ）';
COMMENT ON COLUMN raw.airtable_records.id IS 'Airtable Record ID (recXXX)';
COMMENT ON COLUMN raw.airtable_records.base_id IS '所属ベースID';
COMMENT ON COLUMN raw.airtable_records.table_id IS '所属テーブルID';
COMMENT ON COLUMN raw.airtable_records.created_time IS 'レコード作成日時';
COMMENT ON COLUMN raw.airtable_records.fields IS 'フィールド値（JSONB）';

-- ----------------------------------------------------------------------------
-- インデックス作成
-- ----------------------------------------------------------------------------
CREATE INDEX idx_airtable_tables_base_id ON raw.airtable_tables(base_id);
CREATE INDEX idx_airtable_records_base_id ON raw.airtable_records(base_id);
CREATE INDEX idx_airtable_records_table_id ON raw.airtable_records(table_id);
CREATE INDEX idx_airtable_records_created_time ON raw.airtable_records(created_time);
CREATE INDEX idx_airtable_records_fields ON raw.airtable_records USING GIN(fields);

-- ----------------------------------------------------------------------------
-- RLS設定
-- ----------------------------------------------------------------------------
ALTER TABLE raw.airtable_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.airtable_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.airtable_records ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 権限設定
-- ----------------------------------------------------------------------------
GRANT ALL ON raw.airtable_bases TO service_role;
GRANT ALL ON raw.airtable_tables TO service_role;
GRANT ALL ON raw.airtable_records TO service_role;

GRANT SELECT ON raw.airtable_bases TO anon, authenticated;
GRANT SELECT ON raw.airtable_tables TO anon, authenticated;
GRANT SELECT ON raw.airtable_records TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 完了メッセージ
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Airtable tables created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - raw.airtable_bases';
    RAISE NOTICE '  - raw.airtable_tables';
    RAISE NOTICE '  - raw.airtable_records';
    RAISE NOTICE '';
    RAISE NOTICE 'Setup:';
    RAISE NOTICE '  1. Create a Personal Access Token at:';
    RAISE NOTICE '     https://airtable.com/create/tokens';
    RAISE NOTICE '  2. Add to credentials.services with:';
    RAISE NOTICE '     {"personal_access_token": "patXXX..."}';
    RAISE NOTICE '========================================';
END $$;
