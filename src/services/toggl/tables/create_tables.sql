-- =====================================================
-- 1. Clients Table (正規化版)
-- =====================================================
CREATE TABLE toggl_clients_new (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_new_workspace ON toggl_clients_new(workspace_id);
CREATE INDEX idx_clients_new_archived ON toggl_clients_new(is_archived) WHERE NOT is_archived;

-- RLS設定
ALTER TABLE toggl_clients_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access"
    ON toggl_clients_new
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow service role all access"
    ON toggl_clients_new
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- =====================================================
-- 2. Projects Table (正規化版)
-- =====================================================
CREATE TABLE toggl_projects_new (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    client_id BIGINT REFERENCES toggl_clients_new(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    color TEXT,
    is_private BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_billable BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    -- 推定値のみ保持
    estimated_hours DECIMAL(10,2),
    estimated_seconds BIGINT,
    rate DECIMAL(10,2),
    rate_last_updated TIMESTAMPTZ,
    currency TEXT,
    -- その他のメタデータ
    is_template BOOLEAN DEFAULT false,
    template_id BIGINT,
    auto_estimates BOOLEAN,
    recurring BOOLEAN DEFAULT false,
    recurring_parameters JSONB,
    fixed_fee DECIMAL(10,2),
    can_track_time BOOLEAN DEFAULT true,
    start_date DATE,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_new_workspace ON toggl_projects_new(workspace_id);
CREATE INDEX idx_projects_new_client ON toggl_projects_new(client_id);
CREATE INDEX idx_projects_new_active ON toggl_projects_new(is_active) WHERE is_active;
CREATE INDEX idx_projects_new_archived_at ON toggl_projects_new(archived_at) WHERE archived_at IS NOT NULL;

-- RLS設定
ALTER TABLE toggl_projects_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access"
    ON toggl_projects_new
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow service role all access"
    ON toggl_projects_new
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- =====================================================
-- 3. Time Entries Table (正規化版)
-- =====================================================
CREATE TABLE toggl_time_entries_new (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    project_id BIGINT REFERENCES toggl_projects_new(id) ON DELETE SET NULL,
    task_id BIGINT,
    user_id BIGINT,
    description TEXT,
    start TIMESTAMPTZ NOT NULL,
    "end" TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL,
    is_billable BOOLEAN DEFAULT false,
    billable_amount DECIMAL(10,2),
    currency TEXT,
    tags TEXT[],
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 制約
    CONSTRAINT chk_end_after_start CHECK ("end" >= start),
    CONSTRAINT chk_duration_positive CHECK (duration_ms >= 0)
);

-- パフォーマンス最適化のためのインデックス
CREATE INDEX idx_entries_new_start ON toggl_time_entries_new(start DESC);
CREATE INDEX idx_entries_new_end ON toggl_time_entries_new("end" DESC);
CREATE INDEX idx_entries_new_project ON toggl_time_entries_new(project_id);
CREATE INDEX idx_entries_new_user ON toggl_time_entries_new(user_id);
CREATE INDEX idx_entries_new_workspace ON toggl_time_entries_new(workspace_id);
CREATE INDEX idx_entries_new_start_end ON toggl_time_entries_new(start, "end");
CREATE INDEX idx_entries_new_tags ON toggl_time_entries_new USING GIN(tags);

-- RLS設定
ALTER TABLE toggl_time_entries_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access"
    ON toggl_time_entries_new
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow service role all access"
    ON toggl_time_entries_new
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
-- =====================================================
-- 1. Tags Table (タグマスタ)
-- =====================================================
CREATE TABLE toggl_tags_new (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- ワークスペース内でタグ名は一意
    CONSTRAINT uq_tags_workspace_name UNIQUE (workspace_id, name)
);

CREATE INDEX idx_tags_new_workspace ON toggl_tags_new(workspace_id);
CREATE INDEX idx_tags_new_name ON toggl_tags_new(name);

-- RLS設定
ALTER TABLE toggl_tags_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access"
    ON toggl_tags_new
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow service role all access"
    ON toggl_tags_new
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- =====================================================
-- 2. Time Entry Tags (中間テーブル)
-- =====================================================
CREATE TABLE toggl_time_entry_tags_new (
    time_entry_id BIGINT NOT NULL REFERENCES toggl_time_entries_new(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES toggl_tags_new(id) ON DELETE CASCADE,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (time_entry_id, tag_id)
);

CREATE INDEX idx_entry_tags_new_entry ON toggl_time_entry_tags_new(time_entry_id);
CREATE INDEX idx_entry_tags_new_tag ON toggl_time_entry_tags_new(tag_id);

-- RLS設定
ALTER TABLE toggl_time_entry_tags_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access"
    ON toggl_time_entry_tags_new
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow service role all access"
    ON toggl_time_entry_tags_new
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- =====================================================
-- 3. コメント（ドキュメント化）
-- =====================================================
COMMENT ON TABLE toggl_tags_new IS '正規化されたTogglタグマスタ';
COMMENT ON TABLE toggl_time_entry_tags_new IS 'タイムエントリーとタグの多対多関係';

COMMENT ON COLUMN toggl_tags_new.name IS 'タグ名（例: m:calm, work, personal）';
COMMENT ON CONSTRAINT uq_tags_workspace_name ON toggl_tags_new IS 'ワークスペース内でタグ名は一意';


-- =====================================================
-- 4. コメント（ドキュメント化）
-- =====================================================
COMMENT ON TABLE toggl_clients_new IS '正規化されたTogglクライアントマスタ';
COMMENT ON TABLE toggl_projects_new IS '正規化されたTogglプロジェクトマスタ';
COMMENT ON TABLE toggl_time_entries_new IS '正規化されたToggl時間エントリー（2.5年分）';

COMMENT ON COLUMN toggl_time_entries_new.duration_ms IS '期間（ミリ秒）。Reports APIのdurフィールドに相当';
COMMENT ON COLUMN toggl_time_entries_new.billable_amount IS 'Reports APIのbillableフィールドに相当';
COMMENT ON COLUMN toggl_projects_new.archived_at IS 'プロジェクトがアーカイブされた日時。NULLの場合はアクティブ';