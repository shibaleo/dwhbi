-- Tanita Health Planet Raw Tables Migration
-- Purpose: Store raw API responses from Tanita Health Planet API for long-term data preservation
-- Structure: JSONB storage with source_id for upsert/deduplication
-- Replaces: raw.tanita_body_composition, raw.tanita_blood_pressure, raw.tanita_steps

-- Create raw schema if not exists
CREATE SCHEMA IF NOT EXISTS raw;

-- ============================================================================
-- Body Composition (体組成データ: 体重、体脂肪率)
-- ============================================================================
CREATE TABLE raw.tanita_health_planet__body_composition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.tanita_health_planet__body_composition IS 'Tanita Health Planet API v1 body composition data';
COMMENT ON COLUMN raw.tanita_health_planet__body_composition.source_id IS 'Unique identifier: ISO8601 UTC measurement datetime';
COMMENT ON COLUMN raw.tanita_health_planet__body_composition.data IS 'Raw JSON containing weight, body_fat_percent, model, etc.';
COMMENT ON COLUMN raw.tanita_health_planet__body_composition.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_tanita_hp_body_composition_synced_at
    ON raw.tanita_health_planet__body_composition (synced_at);
CREATE INDEX idx_tanita_hp_body_composition_data_gin
    ON raw.tanita_health_planet__body_composition USING gin (data);

-- ============================================================================
-- Blood Pressure (血圧データ: 最高血圧、最低血圧、脈拍)
-- ============================================================================
CREATE TABLE raw.tanita_health_planet__blood_pressure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

COMMENT ON TABLE raw.tanita_health_planet__blood_pressure IS 'Tanita Health Planet API v1 blood pressure data';
COMMENT ON COLUMN raw.tanita_health_planet__blood_pressure.source_id IS 'Unique identifier: ISO8601 UTC measurement datetime';
COMMENT ON COLUMN raw.tanita_health_planet__blood_pressure.data IS 'Raw JSON containing systolic, diastolic, pulse, model, etc.';
COMMENT ON COLUMN raw.tanita_health_planet__blood_pressure.api_version IS 'API version used to fetch this data';

CREATE INDEX idx_tanita_hp_blood_pressure_synced_at
    ON raw.tanita_health_planet__blood_pressure (synced_at);
CREATE INDEX idx_tanita_hp_blood_pressure_data_gin
    ON raw.tanita_health_planet__blood_pressure USING gin (data);

-- ============================================================================
-- RLS (Row Level Security) 設定
-- raw層はサービスロールのみアクセス可能
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE raw.tanita_health_planet__body_composition ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.tanita_health_planet__blood_pressure ENABLE ROW LEVEL SECURITY;

-- Service role bypass policy (サービスロールは全操作可能)
CREATE POLICY "Service role has full access to tanita_health_planet__body_composition"
    ON raw.tanita_health_planet__body_composition
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to tanita_health_planet__blood_pressure"
    ON raw.tanita_health_planet__blood_pressure
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Data Migration (既存データの移行)
-- ============================================================================

-- 体組成データ移行
INSERT INTO raw.tanita_health_planet__body_composition (source_id, data, synced_at)
SELECT
    to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_id,
    jsonb_build_object(
        'weight', weight,
        'body_fat_percent', body_fat_percent,
        'model', model,
        '_measured_at_jst', to_char(measured_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"'),
        '_migrated_from', 'tanita_body_composition',
        '_migrated_at', now()
    ) as data,
    synced_at
FROM raw.tanita_body_composition
ON CONFLICT (source_id) DO NOTHING;

-- 血圧データ移行
INSERT INTO raw.tanita_health_planet__blood_pressure (source_id, data, synced_at)
SELECT
    to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_id,
    jsonb_build_object(
        'systolic', systolic,
        'diastolic', diastolic,
        'pulse', pulse,
        'model', model,
        '_measured_at_jst', to_char(measured_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"'),
        '_migrated_from', 'tanita_blood_pressure',
        '_migrated_at', now()
    ) as data,
    synced_at
FROM raw.tanita_blood_pressure
ON CONFLICT (source_id) DO NOTHING;

-- ============================================================================
-- NOTE: Vault secret rename (tanita -> tanita_health_planet)
-- must be done manually via Supabase Dashboard or vault functions
-- ============================================================================

-- ============================================================================
-- Drop old tables (既存テーブルを削除)
-- ============================================================================
DROP TABLE IF EXISTS raw.tanita_body_composition;
DROP TABLE IF EXISTS raw.tanita_blood_pressure;
DROP TABLE IF EXISTS raw.tanita_steps;
