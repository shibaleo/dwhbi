-- Togglプロジェクトテーブルの作成
CREATE TABLE IF NOT EXISTS toggl_projects (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    client_id BIGINT,
    name TEXT NOT NULL,
    is_private BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    server_deleted_at TIMESTAMP WITH TIME ZONE,
    color TEXT,
    billable BOOLEAN DEFAULT false,
    template TEXT,
    auto_estimates TEXT,
    estimated_hours INTEGER,
    estimated_seconds INTEGER,
    rate DECIMAL(10, 2),
    rate_last_updated TIMESTAMP WITH TIME ZONE,
    currency TEXT,
    recurring BOOLEAN DEFAULT false,
    template_id BIGINT,
    recurring_parameters JSONB,
    fixed_fee DECIMAL(10, 2),
    actual_hours INTEGER,
    actual_seconds INTEGER,
    total_count INTEGER DEFAULT 0,
    client_name TEXT,
    can_track_time BOOLEAN DEFAULT true,
    start_date DATE,
    status TEXT DEFAULT 'active',
    wid BIGINT,
    cid BIGINT,
    pinned BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_toggl_projects_workspace_id ON toggl_projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_toggl_projects_client_id ON toggl_projects(client_id);
CREATE INDEX IF NOT EXISTS idx_toggl_projects_name ON toggl_projects(name);
CREATE INDEX IF NOT EXISTS idx_toggl_projects_status ON toggl_projects(status);
CREATE INDEX IF NOT EXISTS idx_toggl_projects_active ON toggl_projects(active);
CREATE INDEX IF NOT EXISTS idx_toggl_projects_start_date ON toggl_projects(start_date);

-- 外部キー制約（toggl_clientsテーブルが存在する場合）
ALTER TABLE toggl_projects
ADD CONSTRAINT fk_toggl_projects_client
FOREIGN KEY (client_id) REFERENCES toggl_clients(id)
ON DELETE SET NULL;

-- updated_atを自動更新するトリガー関数
CREATE OR REPLACE FUNCTION update_toggl_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーの作成
CREATE TRIGGER update_toggl_projects_timestamp
    BEFORE UPDATE ON toggl_projects
    FOR EACH ROW
    EXECUTE FUNCTION update_toggl_projects_updated_at();

-- コメントの追加
COMMENT ON TABLE toggl_projects IS 'Togglのプロジェクト情報';
COMMENT ON COLUMN toggl_projects.id IS 'TogglプロジェクトID';
COMMENT ON COLUMN toggl_projects.workspace_id IS 'TogglワークスペースID';
COMMENT ON COLUMN toggl_projects.client_id IS 'TogglクライアントID';
COMMENT ON COLUMN toggl_projects.name IS 'プロジェクト名';
COMMENT ON COLUMN toggl_projects.is_private IS 'プライベートプロジェクトフラグ';
COMMENT ON COLUMN toggl_projects.active IS 'アクティブフラグ';
COMMENT ON COLUMN toggl_projects.at IS 'Togglでの作成/更新時刻';
COMMENT ON COLUMN toggl_projects.created_at IS 'プロジェクト作成時刻';
COMMENT ON COLUMN toggl_projects.server_deleted_at IS 'サーバー削除時刻';
COMMENT ON COLUMN toggl_projects.color IS 'プロジェクトカラー（HEXコード）';
COMMENT ON COLUMN toggl_projects.billable IS '請求可能フラグ';
COMMENT ON COLUMN toggl_projects.template IS 'テンプレート';
COMMENT ON COLUMN toggl_projects.auto_estimates IS '自動見積もり設定';
COMMENT ON COLUMN toggl_projects.estimated_hours IS '見積もり時間';
COMMENT ON COLUMN toggl_projects.estimated_seconds IS '見積もり秒数';
COMMENT ON COLUMN toggl_projects.rate IS '時給レート';
COMMENT ON COLUMN toggl_projects.rate_last_updated IS 'レート最終更新時刻';
COMMENT ON COLUMN toggl_projects.currency IS '通貨';
COMMENT ON COLUMN toggl_projects.recurring IS '繰り返しフラグ';
COMMENT ON COLUMN toggl_projects.template_id IS 'テンプレートID';
COMMENT ON COLUMN toggl_projects.recurring_parameters IS '繰り返しパラメータ（JSON）';
COMMENT ON COLUMN toggl_projects.fixed_fee IS '固定料金';
COMMENT ON COLUMN toggl_projects.actual_hours IS '実際の作業時間';
COMMENT ON COLUMN toggl_projects.actual_seconds IS '実際の作業秒数';
COMMENT ON COLUMN toggl_projects.total_count IS '関連エントリー数';
COMMENT ON COLUMN toggl_projects.client_name IS 'クライアント名（キャッシュ）';
COMMENT ON COLUMN toggl_projects.can_track_time IS 'タイムトラッキング可能フラグ';
COMMENT ON COLUMN toggl_projects.start_date IS 'プロジェクト開始日';
COMMENT ON COLUMN toggl_projects.status IS 'ステータス（active/archived）';
COMMENT ON COLUMN toggl_projects.wid IS 'ワークスペースID（互換性用）';
COMMENT ON COLUMN toggl_projects.cid IS 'クライアントID（互換性用）';
COMMENT ON COLUMN toggl_projects.pinned IS 'ピン留めフラグ';
COMMENT ON COLUMN toggl_projects.updated_at IS 'Supabaseでの最終更新時刻';