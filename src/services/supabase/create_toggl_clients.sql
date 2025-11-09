-- Togglクライアントテーブルの作成
CREATE TABLE IF NOT EXISTS toggl_clients (
    id BIGINT PRIMARY KEY,
    wid BIGINT NOT NULL,
    archived BOOLEAN DEFAULT false,
    name TEXT NOT NULL,
    at TIMESTAMP WITH TIME ZONE,
    creator_id BIGINT,
    total_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_toggl_clients_wid ON toggl_clients(wid);
CREATE INDEX IF NOT EXISTS idx_toggl_clients_name ON toggl_clients(name);
CREATE INDEX IF NOT EXISTS idx_toggl_clients_archived ON toggl_clients(archived);

-- updated_atを自動更新するトリガー関数
CREATE OR REPLACE FUNCTION update_toggl_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーの作成
CREATE TRIGGER update_toggl_clients_timestamp
    BEFORE UPDATE ON toggl_clients
    FOR EACH ROW
    EXECUTE FUNCTION update_toggl_clients_updated_at();

-- コメントの追加
COMMENT ON TABLE toggl_clients IS 'Togglのクライアント（カテゴリー）情報';
COMMENT ON COLUMN toggl_clients.id IS 'TogglクライアントID';
COMMENT ON COLUMN toggl_clients.wid IS 'TogglワークスペースID';
COMMENT ON COLUMN toggl_clients.archived IS 'アーカイブ済みフラグ';
COMMENT ON COLUMN toggl_clients.name IS 'クライアント名（WORK, SLEEP等）';
COMMENT ON COLUMN toggl_clients.at IS 'Togglでの作成/更新時刻';
COMMENT ON COLUMN toggl_clients.creator_id IS '作成者のTogglユーザーID';
COMMENT ON COLUMN toggl_clients.total_count IS '関連プロジェクト数';
COMMENT ON COLUMN toggl_clients.created_at IS 'Supabaseでの作成時刻';
COMMENT ON COLUMN toggl_clients.updated_at IS 'Supabaseでの最終更新時刻';