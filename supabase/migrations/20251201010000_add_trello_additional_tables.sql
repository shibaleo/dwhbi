-- ============================================================================
-- Trello Additional Tables in raw Schema
-- Created: 2025-12-01
-- ============================================================================
--
-- 追加テーブル:
--   - trello_actions: アクティビティ履歴（コメント、更新、移動など）
--   - trello_checklists: チェックリスト
--   - trello_checkitems: チェックリスト内のアイテム
--   - trello_custom_fields: カスタムフィールド定義
--   - trello_custom_field_items: カードに設定されたカスタムフィールド値
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- raw.trello_actions
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_actions (
    id TEXT PRIMARY KEY,
    board_id TEXT REFERENCES raw.trello_boards(id),
    card_id TEXT,
    list_id TEXT,
    member_creator_id TEXT,
    type TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    data JSONB,
    member_creator JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_actions IS 'Trelloアクション履歴（生データ）';
COMMENT ON COLUMN raw.trello_actions.id IS 'Trello Action ID';
COMMENT ON COLUMN raw.trello_actions.type IS 'アクションタイプ（commentCard, updateCard, createCard, etc.）';
COMMENT ON COLUMN raw.trello_actions.date IS 'アクション実行日時';
COMMENT ON COLUMN raw.trello_actions.data IS 'アクション固有データ（text, card, board, list, old, etc.）';
COMMENT ON COLUMN raw.trello_actions.member_creator IS 'アクション実行者の詳細情報';

-- ----------------------------------------------------------------------------
-- raw.trello_checklists
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_checklists (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES raw.trello_boards(id),
    card_id TEXT NOT NULL REFERENCES raw.trello_cards(id),
    name TEXT NOT NULL,
    pos NUMERIC,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_checklists IS 'Trelloチェックリスト（生データ）';
COMMENT ON COLUMN raw.trello_checklists.id IS 'Trello Checklist ID';
COMMENT ON COLUMN raw.trello_checklists.card_id IS '所属カードID';
COMMENT ON COLUMN raw.trello_checklists.pos IS '表示順序';

-- ----------------------------------------------------------------------------
-- raw.trello_checkitems
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_checkitems (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES raw.trello_checklists(id),
    name TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('complete', 'incomplete')),
    pos NUMERIC,
    due TIMESTAMPTZ,
    id_member TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_checkitems IS 'Trelloチェックアイテム（生データ）';
COMMENT ON COLUMN raw.trello_checkitems.id IS 'Trello CheckItem ID';
COMMENT ON COLUMN raw.trello_checkitems.checklist_id IS '所属チェックリストID';
COMMENT ON COLUMN raw.trello_checkitems.state IS '状態（complete/incomplete）';
COMMENT ON COLUMN raw.trello_checkitems.due IS '期限';
COMMENT ON COLUMN raw.trello_checkitems.id_member IS '担当メンバーID';

-- ----------------------------------------------------------------------------
-- raw.trello_custom_fields
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_custom_fields (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES raw.trello_boards(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    pos NUMERIC,
    display JSONB,
    options JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_custom_fields IS 'Trelloカスタムフィールド定義（生データ）';
COMMENT ON COLUMN raw.trello_custom_fields.id IS 'Trello CustomField ID';
COMMENT ON COLUMN raw.trello_custom_fields.type IS 'フィールドタイプ（text, number, date, checkbox, list）';
COMMENT ON COLUMN raw.trello_custom_fields.display IS '表示設定（cardFront等）';
COMMENT ON COLUMN raw.trello_custom_fields.options IS 'リスト型の選択肢';

-- ----------------------------------------------------------------------------
-- raw.trello_custom_field_items
-- ----------------------------------------------------------------------------
CREATE TABLE raw.trello_custom_field_items (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES raw.trello_cards(id),
    custom_field_id TEXT NOT NULL REFERENCES raw.trello_custom_fields(id),
    value JSONB,
    id_value TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.trello_custom_field_items IS 'Trelloカスタムフィールド値（生データ）';
COMMENT ON COLUMN raw.trello_custom_field_items.id IS '複合ID（card_id + custom_field_id）';
COMMENT ON COLUMN raw.trello_custom_field_items.value IS 'フィールド値（text, number, date, checked）';
COMMENT ON COLUMN raw.trello_custom_field_items.id_value IS 'リスト型の選択肢ID';

-- ----------------------------------------------------------------------------
-- インデックス作成
-- ----------------------------------------------------------------------------
CREATE INDEX idx_trello_actions_board_id ON raw.trello_actions(board_id);
CREATE INDEX idx_trello_actions_card_id ON raw.trello_actions(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX idx_trello_actions_type ON raw.trello_actions(type);
CREATE INDEX idx_trello_actions_date ON raw.trello_actions(date);
CREATE INDEX idx_trello_actions_member_creator_id ON raw.trello_actions(member_creator_id) WHERE member_creator_id IS NOT NULL;

CREATE INDEX idx_trello_checklists_board_id ON raw.trello_checklists(board_id);
CREATE INDEX idx_trello_checklists_card_id ON raw.trello_checklists(card_id);

CREATE INDEX idx_trello_checkitems_checklist_id ON raw.trello_checkitems(checklist_id);
CREATE INDEX idx_trello_checkitems_state ON raw.trello_checkitems(state);

CREATE INDEX idx_trello_custom_fields_board_id ON raw.trello_custom_fields(board_id);

CREATE INDEX idx_trello_custom_field_items_card_id ON raw.trello_custom_field_items(card_id);
CREATE INDEX idx_trello_custom_field_items_custom_field_id ON raw.trello_custom_field_items(custom_field_id);

-- ----------------------------------------------------------------------------
-- RLS設定
-- ----------------------------------------------------------------------------
ALTER TABLE raw.trello_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_checkitems ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.trello_custom_field_items ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 権限設定
-- ----------------------------------------------------------------------------
GRANT ALL ON raw.trello_actions TO service_role;
GRANT ALL ON raw.trello_checklists TO service_role;
GRANT ALL ON raw.trello_checkitems TO service_role;
GRANT ALL ON raw.trello_custom_fields TO service_role;
GRANT ALL ON raw.trello_custom_field_items TO service_role;

GRANT SELECT ON raw.trello_actions TO anon, authenticated;
GRANT SELECT ON raw.trello_checklists TO anon, authenticated;
GRANT SELECT ON raw.trello_checkitems TO anon, authenticated;
GRANT SELECT ON raw.trello_custom_fields TO anon, authenticated;
GRANT SELECT ON raw.trello_custom_field_items TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 完了メッセージ
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Trello additional tables created!';
    RAISE NOTICE '';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - raw.trello_actions';
    RAISE NOTICE '  - raw.trello_checklists';
    RAISE NOTICE '  - raw.trello_checkitems';
    RAISE NOTICE '  - raw.trello_custom_fields';
    RAISE NOTICE '  - raw.trello_custom_field_items';
    RAISE NOTICE '========================================';
END $$;
