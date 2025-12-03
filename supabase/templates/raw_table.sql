-- ============================================================================
-- raw層テーブルテンプレート
--
-- 使い方:
--   1. {service} をサービス名に置換（例: toggl_track, fitbit, zaim）
--   2. {entity} をエンティティ名に置換（例: time_entries, sleep_logs）
--   3. {description} を説明に置換（例: Toggl Track time entries）
--   4. {source_id_desc} をsource_idの説明に置換（例: entry id, log id）
--
-- 命名規則:
--   - サービス名: snake_case（toggl_track, google_calendar）
--   - エンティティ名: snake_case、複数形（time_entries, projects）
--   - テーブル名: {service}__{entity}（ダブルアンダースコア）
-- ============================================================================

-- テーブル作成
CREATE TABLE IF NOT EXISTS raw.{service}__{entity} (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    api_version TEXT
);

COMMENT ON TABLE raw.{service}__{entity} IS '{description}';
COMMENT ON COLUMN raw.{service}__{entity}.source_id IS 'Unique identifier from API response ({source_id_desc})';

-- インデックス
CREATE INDEX IF NOT EXISTS idx_{service}__{entity}_synced_at
    ON raw.{service}__{entity} (synced_at);
CREATE INDEX IF NOT EXISTS idx_{service}__{entity}_data_gin
    ON raw.{service}__{entity} USING gin (data);

-- RLS設定
ALTER TABLE raw.{service}__{entity} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to {service}__{entity}"
    ON raw.{service}__{entity}
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
