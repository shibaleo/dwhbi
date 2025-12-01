-- ============================================================================
-- Trello Tables in raw Schema
-- Created: 2025-12-01
-- ============================================================================
--
-- Trelloデータ構造:
--   - boards: ボード（プロジェクト単位）
--   - lists: リスト（カンバンの列）
--   - labels: ラベル（カードの分類）
--   - cards: カード（タスク）
--
-- 認証方式: API Key + Token (クエリパラメータ)
-- API Base URL: https://api.trello.com/1
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- raw.trello_boards
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    short_url TEXT,
    is_closed BOOLEAN DEFAULT false,
    id_organization TEXT,
    pinned BOOLEAN DEFAULT false,
    starred BOOLEAN DEFAULT false,
    date_last_activity TIMESTAMPTZ,
    date_last_view TIMESTAMPTZ,
    prefs JSONB,
    label_names JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_boards IS 'Trelloボード（生データ）';
COMMENT ON COLUMN raw.trello_boards.id IS 'Trello Board ID';
COMMENT ON COLUMN raw.trello_boards.is_closed IS 'アーカイブ済みかどうか';
COMMENT ON COLUMN raw.trello_boards.prefs IS 'ボード設定（背景色、権限など）';
COMMENT ON COLUMN raw.trello_boards.label_names IS 'ラベル名のマッピング（色→名前）';

-- ----------------------------------------------------------------------------
-- raw.trello_lists
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_lists (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES raw.trello_boards(id),
    name TEXT NOT NULL,
    pos NUMERIC,
    is_closed BOOLEAN DEFAULT false,
    subscribed BOOLEAN DEFAULT false,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_lists IS 'Trelloリスト（生データ）';
COMMENT ON COLUMN raw.trello_lists.id IS 'Trello List ID';
COMMENT ON COLUMN raw.trello_lists.board_id IS '所属ボードID';
COMMENT ON COLUMN raw.trello_lists.pos IS 'リストの表示順序';
COMMENT ON COLUMN raw.trello_lists.is_closed IS 'アーカイブ済みかどうか';

-- ----------------------------------------------------------------------------
-- raw.trello_labels
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_labels (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES raw.trello_boards(id),
    name TEXT,
    color TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_labels IS 'Trelloラベル（生データ）';
COMMENT ON COLUMN raw.trello_labels.id IS 'Trello Label ID';
COMMENT ON COLUMN raw.trello_labels.board_id IS '所属ボードID';
COMMENT ON COLUMN raw.trello_labels.color IS 'ラベルの色（green, yellow, orange, red, purple, blue, sky, lime, pink, black, null）';

-- ----------------------------------------------------------------------------
-- raw.trello_cards
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_cards (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES raw.trello_boards(id),
    list_id TEXT NOT NULL REFERENCES raw.trello_lists(id),
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    short_url TEXT,
    pos NUMERIC,
    is_closed BOOLEAN DEFAULT false,
    due TIMESTAMPTZ,
    due_complete BOOLEAN DEFAULT false,
    date_last_activity TIMESTAMPTZ,
    id_members TEXT[],
    id_labels TEXT[],
    labels JSONB,
    badges JSONB,
    cover JSONB,
    checklists JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_cards IS 'Trelloカード（生データ）';
COMMENT ON COLUMN raw.trello_cards.id IS 'Trello Card ID';
COMMENT ON COLUMN raw.trello_cards.board_id IS '所属ボードID';
COMMENT ON COLUMN raw.trello_cards.list_id IS '所属リストID';
COMMENT ON COLUMN raw.trello_cards.pos IS 'カードの表示順序';
COMMENT ON COLUMN raw.trello_cards.is_closed IS 'アーカイブ済みかどうか';
COMMENT ON COLUMN raw.trello_cards.due IS '期限日時';
COMMENT ON COLUMN raw.trello_cards.due_complete IS '期限完了フラグ';
COMMENT ON COLUMN raw.trello_cards.id_members IS '割り当てられたメンバーIDの配列';
COMMENT ON COLUMN raw.trello_cards.id_labels IS 'ラベルIDの配列';
COMMENT ON COLUMN raw.trello_cards.labels IS 'ラベル詳細情報';
COMMENT ON COLUMN raw.trello_cards.badges IS 'バッジ情報（コメント数、添付ファイル数など）';
COMMENT ON COLUMN raw.trello_cards.cover IS 'カバー画像情報';
COMMENT ON COLUMN raw.trello_cards.checklists IS 'チェックリスト情報';

-- ----------------------------------------------------------------------------
-- インデックス作成
-- ----------------------------------------------------------------------------
CREATE INDEX idx_trello_lists_board_id ON raw.trello_lists(board_id);
CREATE INDEX idx_trello_labels_board_id ON raw.trello_labels(board_id);
CREATE INDEX idx_trello_cards_board_id ON raw.trello_cards(board_id);
CREATE INDEX idx_trello_cards_list_id ON raw.trello_cards(list_id);
CREATE INDEX idx_trello_cards_due ON raw.trello_cards(due) WHERE due IS NOT NULL;
CREATE INDEX idx_trello_cards_date_last_activity ON raw.trello_cards(date_last_activity);

-- ----------------------------------------------------------------------------
-- RLS設定
-- ----------------------------------------------------------------------------
ALTER TABLE raw.trello_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_cards ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 権限設定
-- ----------------------------------------------------------------------------
GRANT ALL ON raw.trello_boards TO service_role;
GRANT ALL ON raw.trello_lists TO service_role;
GRANT ALL ON raw.trello_labels TO service_role;
GRANT ALL ON raw.trello_cards TO service_role;

GRANT SELECT ON raw.trello_boards TO anon, authenticated;
GRANT SELECT ON raw.trello_lists TO anon, authenticated;
GRANT SELECT ON raw.trello_labels TO anon, authenticated;
GRANT SELECT ON raw.trello_cards TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 完了メッセージ
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Trello tables created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - raw.trello_boards';
    RAISE NOTICE '  - raw.trello_lists';
    RAISE NOTICE '  - raw.trello_labels';
    RAISE NOTICE '  - raw.trello_cards';
    RAISE NOTICE '';
    RAISE NOTICE 'Credentials required in credentials.services:';
    RAISE NOTICE '  - api_key: Trello API Key';
    RAISE NOTICE '  - api_token: Trello API Token';
    RAISE NOTICE '  - member_id: Trello Member ID (optional, defaults to "me")';
    RAISE NOTICE '========================================';
END $$;
