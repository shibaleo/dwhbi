-- ============================================================================
-- Create Time Analysis Master Tables
-- Created: 2025-12-05
-- ============================================================================
--
-- Designative Liability:
--   このマイグレーションには以下のDLが含まれる:
--   - [DL-002] client → time_category の用語統一
--   - [DL-003] Toggl色とCalendar色のマッピング
--   - [DL-004] 色に「時間の質」の意味を付与
--   - [DL-001] Calendar descriptionからカテゴリを抽出
--
-- 参照: docs/design/decisions/designative-liability-registry.md
-- ============================================================================

-- ============================================================================
-- [DL-002] Time Categories Master
-- Togglの「client」をシステム共通の「time_category」として管理
-- ============================================================================
CREATE TABLE ref.mst_time_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,           -- 'WORK', 'LEISURE', 'ACADEMIC' など
    description TEXT,                     -- カテゴリの説明
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE ref.mst_time_categories IS '[DL-002] 時間カテゴリマスタ。Togglのclientと1:1対応';

-- 初期データ（Togglのclient名に対応）
INSERT INTO ref.mst_time_categories (name, description, sort_order) VALUES
    ('WORK', '業務・労働', 1),
    ('LEISURE', '余暇・娯楽', 2),
    ('ACADEMIC', '学問・研究', 3),
    ('STUDY', '学習・スキルアップ', 4),
    ('HEALTH', '健康・運動', 5),
    ('LIFE', '生活・用事', 6),
    ('SLEEP', '睡眠', 7),
    ('REFLECT', '振り返り・管理', 8);

-- ============================================================================
-- [DL-003][DL-004] Time Qualities Master
-- Toggl/Calendar色に「時間の質」という意味を付与
-- ============================================================================
CREATE TABLE ref.mst_time_qualities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,                   -- '管理', '勉強', '仕事' など
    description TEXT,                     -- 質の説明
    -- [DL-003] Toggl色
    toggl_color_hex TEXT,                 -- '#0b83d9'
    toggl_color_name TEXT,                -- 'Blue'
    -- [DL-003] Google Calendar色
    gcalendar_color_hex TEXT,             -- '#039be5'
    gcalendar_color_name TEXT,            -- 'Peacock'
    gcalendar_color_id TEXT,              -- '7' (Calendar API用)
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE ref.mst_time_qualities IS '[DL-003][DL-004] 時間の質マスタ。Toggl/Calendar色のマッピングと意味付け';

-- [DL-004] 初期データ：色に意味を付与
INSERT INTO ref.mst_time_qualities (
    name, description,
    toggl_color_hex, toggl_color_name,
    gcalendar_color_hex, gcalendar_color_name, gcalendar_color_id,
    sort_order
) VALUES
    ('管理', '自己管理、振り返り、計画', '#0b83d9', 'Blue', '#039be5', 'Peacock', '7', 1),
    ('勉強', '学習、スキルアップ、読書', '#2da608', 'Green', '#0b8043', 'Basil', '10', 2),
    ('用事', '雑務、手続き、家事', '#06a893', 'Teal', '#33b679', 'Sage', '2', 3),
    ('必須', '生理的必需（食事、衛生、身支度）', '#c9806b', 'Peach', '#e67c73', 'Flamingo', '4', 4),
    ('仕事', '業務、労働、会議', '#465bb3', 'Indigo', '#3f51b5', 'Blueberry', '9', 5),
    ('余暇', '娯楽、リラックス、趣味', '#990099', 'Magenta', '#8e24aa', 'Grape', '3', 6),
    ('漂流', '無意識的な時間消費', '#566614', 'Olive', '#7986cb', 'Lavender', '1', 7),
    ('未使用', '予備', '#525266', 'Gray', '#616161', 'Graphite', '8', 8),
    ('睡眠', '睡眠', '#e36a00', 'Orange', '#f4511e', 'Tangerine', '6', 9),
    ('運動', '身体活動、スポーツ', '#c7af14', 'Yellow', '#f6bf26', 'Banana', '5', 10),
    ('学問', '学術的探求、研究', '#d92b2b', 'Red', '#d50000', 'Tomato', '11', 11);

-- ============================================================================
-- [DL-001] Google Calendar Category Mapping
-- Calendar descriptionの1行目からtime_categoryへのマッピング
-- ============================================================================
CREATE TABLE ref.map_gcalendar_categories (
    id SERIAL PRIMARY KEY,
    description_pattern TEXT NOT NULL UNIQUE,  -- "WORK", "LEISURE" など
    category_id INTEGER REFERENCES ref.mst_time_categories(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE ref.map_gcalendar_categories IS '[DL-001] Calendar description → time_category マッピング';

-- 初期データ
INSERT INTO ref.map_gcalendar_categories (description_pattern, category_id)
SELECT pattern, c.id
FROM (VALUES
    ('WORK'),
    ('LEISURE'),
    ('ACADEMIC'),
    ('STUDY'),
    ('HEALTH'),
    ('LIFE'),
    ('SLEEP'),
    ('REFLECT')
) AS patterns(pattern)
JOIN ref.mst_time_categories c ON c.name = patterns.pattern;

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_mst_time_qualities_toggl_hex ON ref.mst_time_qualities(toggl_color_hex);
CREATE INDEX idx_mst_time_qualities_gcal_id ON ref.mst_time_qualities(gcalendar_color_id);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION ref.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_mst_time_categories_updated_at
    BEFORE UPDATE ON ref.mst_time_categories
    FOR EACH ROW EXECUTE FUNCTION ref.update_updated_at_column();

CREATE TRIGGER update_mst_time_qualities_updated_at
    BEFORE UPDATE ON ref.mst_time_qualities
    FOR EACH ROW EXECUTE FUNCTION ref.update_updated_at_column();

CREATE TRIGGER update_map_gcalendar_categories_updated_at
    BEFORE UPDATE ON ref.map_gcalendar_categories
    FOR EACH ROW EXECUTE FUNCTION ref.update_updated_at_column();
