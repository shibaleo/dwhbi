-- ============================================================================
-- TickTick Tables in raw Schema
-- Created: 2025-12-01
-- ============================================================================
--
-- TickTickデータ構造:
--   - projects: プロジェクト（タスクリスト）
--   - tasks: タスク
--   - completed_tasks: 完了済みタスク（アーカイブ用）
--
-- 認証方式: OAuth2 (Authorization Code Flow)
-- API Base URL: https://api.ticktick.com/open/v1
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- raw.ticktick_projects
-- ----------------------------------------------------------------------------
CREATE TABLE raw.ticktick_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    sort_order BIGINT,
    sort_type TEXT,
    view_mode TEXT,
    kind TEXT,
    is_owner BOOLEAN DEFAULT true,
    closed BOOLEAN DEFAULT false,
    group_id TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.ticktick_projects IS 'TickTickプロジェクト（生データ）';
COMMENT ON COLUMN raw.ticktick_projects.id IS 'TickTick Project ID';
COMMENT ON COLUMN raw.ticktick_projects.name IS 'プロジェクト名';
COMMENT ON COLUMN raw.ticktick_projects.color IS 'プロジェクトの色';
COMMENT ON COLUMN raw.ticktick_projects.sort_order IS '並び順';
COMMENT ON COLUMN raw.ticktick_projects.view_mode IS '表示モード（list, kanban等）';
COMMENT ON COLUMN raw.ticktick_projects.kind IS 'プロジェクトの種類';
COMMENT ON COLUMN raw.ticktick_projects.closed IS 'アーカイブ済みかどうか';

-- ----------------------------------------------------------------------------
-- raw.ticktick_tasks
-- ----------------------------------------------------------------------------
CREATE TABLE raw.ticktick_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES raw.ticktick_projects(id),
    title TEXT NOT NULL,
    content TEXT,
    description TEXT,
    priority INTEGER DEFAULT 0,
    status INTEGER DEFAULT 0,
    sort_order BIGINT,
    start_date TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    completed_time TIMESTAMPTZ,
    timezone TEXT,
    is_all_day BOOLEAN DEFAULT false,
    reminder TEXT,
    reminders JSONB,
    repeat_flag TEXT,
    tags TEXT[],
    items JSONB,
    progress INTEGER DEFAULT 0,
    kind TEXT,
    created_time TIMESTAMPTZ,
    modified_time TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.ticktick_tasks IS 'TickTickタスク（生データ）';
COMMENT ON COLUMN raw.ticktick_tasks.id IS 'TickTick Task ID';
COMMENT ON COLUMN raw.ticktick_tasks.project_id IS '所属プロジェクトID';
COMMENT ON COLUMN raw.ticktick_tasks.title IS 'タスク名';
COMMENT ON COLUMN raw.ticktick_tasks.content IS 'タスク内容（マークダウン）';
COMMENT ON COLUMN raw.ticktick_tasks.description IS 'タスク説明';
COMMENT ON COLUMN raw.ticktick_tasks.priority IS '優先度（0:なし, 1:低, 3:中, 5:高）';
COMMENT ON COLUMN raw.ticktick_tasks.status IS 'ステータス（0:未完了, 2:完了）';
COMMENT ON COLUMN raw.ticktick_tasks.start_date IS '開始日時';
COMMENT ON COLUMN raw.ticktick_tasks.due_date IS '期限日時';
COMMENT ON COLUMN raw.ticktick_tasks.completed_time IS '完了日時';
COMMENT ON COLUMN raw.ticktick_tasks.is_all_day IS '終日タスクかどうか';
COMMENT ON COLUMN raw.ticktick_tasks.repeat_flag IS '繰り返し設定';
COMMENT ON COLUMN raw.ticktick_tasks.tags IS 'タグの配列';
COMMENT ON COLUMN raw.ticktick_tasks.items IS 'サブタスク情報';
COMMENT ON COLUMN raw.ticktick_tasks.progress IS '進捗率（0-100）';

-- ----------------------------------------------------------------------------
-- raw.ticktick_completed_tasks
-- 完了済みタスクの履歴保存用（差分同期で取得）
-- ----------------------------------------------------------------------------
CREATE TABLE raw.ticktick_completed_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT NOT NULL,
    content TEXT,
    description TEXT,
    priority INTEGER DEFAULT 0,
    status INTEGER DEFAULT 2,
    start_date TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    completed_time TIMESTAMPTZ NOT NULL,
    timezone TEXT,
    is_all_day BOOLEAN DEFAULT false,
    tags TEXT[],
    items JSONB,
    created_time TIMESTAMPTZ,
    modified_time TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.ticktick_completed_tasks IS 'TickTick完了済みタスク（生データ）';
COMMENT ON COLUMN raw.ticktick_completed_tasks.id IS 'TickTick Task ID';
COMMENT ON COLUMN raw.ticktick_completed_tasks.completed_time IS '完了日時';

-- ----------------------------------------------------------------------------
-- インデックス作成
-- ----------------------------------------------------------------------------
CREATE INDEX idx_ticktick_tasks_project_id ON raw.ticktick_tasks(project_id);
CREATE INDEX idx_ticktick_tasks_status ON raw.ticktick_tasks(status);
CREATE INDEX idx_ticktick_tasks_due_date ON raw.ticktick_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_ticktick_tasks_priority ON raw.ticktick_tasks(priority) WHERE priority > 0;
CREATE INDEX idx_ticktick_tasks_completed_time ON raw.ticktick_tasks(completed_time) WHERE completed_time IS NOT NULL;
CREATE INDEX idx_ticktick_tasks_tags ON raw.ticktick_tasks USING GIN(tags) WHERE tags IS NOT NULL;

CREATE INDEX idx_ticktick_completed_tasks_project_id ON raw.ticktick_completed_tasks(project_id);
CREATE INDEX idx_ticktick_completed_tasks_completed_time ON raw.ticktick_completed_tasks(completed_time);

-- ----------------------------------------------------------------------------
-- RLS設定
-- ----------------------------------------------------------------------------
ALTER TABLE raw.ticktick_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.ticktick_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.ticktick_completed_tasks ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 権限設定
-- ----------------------------------------------------------------------------
GRANT ALL ON raw.ticktick_projects TO service_role;
GRANT ALL ON raw.ticktick_tasks TO service_role;
GRANT ALL ON raw.ticktick_completed_tasks TO service_role;

GRANT SELECT ON raw.ticktick_projects TO anon, authenticated;
GRANT SELECT ON raw.ticktick_tasks TO anon, authenticated;
GRANT SELECT ON raw.ticktick_completed_tasks TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 完了メッセージ
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'TickTick tables created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - raw.ticktick_projects';
    RAISE NOTICE '  - raw.ticktick_tasks';
    RAISE NOTICE '  - raw.ticktick_completed_tasks';
    RAISE NOTICE '';
    RAISE NOTICE 'Run init_ticktick_oauth.py to setup OAuth2';
    RAISE NOTICE '========================================';
END $$;
