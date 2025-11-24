-- ============================================================================
-- Create ref Schema: Reference/Master Data
-- Created: 2024-11-24
-- ============================================================================
--
-- 用途:
--   ref.*  - 静的参照データ・マスターテーブル
--           APIから取得しない、ユーザー定義の参照情報
--
-- テーブル例:
--   ref.toggl_colors       - Toggl無料プランの色一覧
--   ref.gcalendar_colors   - Google Calendar の色一覧
--   ref.color_mapping      - Toggl ↔ Google Calendar のマッピング
--
-- ============================================================================

-- スキーマ作成
CREATE SCHEMA IF NOT EXISTS ref;

-- コメント追加
COMMENT ON SCHEMA ref IS '静的参照データ・マスターテーブル。色一覧、マッピング等。';

-- search_path に追加
ALTER DATABASE postgres SET search_path TO public, raw, staging, marts, ref, extensions;

-- 現在のセッションにも適用
SET search_path TO public, raw, staging, marts, ref, extensions;

-- 権限設定（Supabaseのロールにアクセス許可）
GRANT USAGE ON SCHEMA ref TO anon, authenticated, service_role;

-- 将来作成されるオブジェクトへのデフォルト権限
ALTER DEFAULT PRIVILEGES IN SCHEMA ref GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ref GRANT ALL ON TABLES TO service_role;

-- ============================================================================
-- Toggl Colors (Free Plan)
-- ============================================================================
CREATE TABLE ref.toggl_colors (
    id SERIAL PRIMARY KEY,
    hex VARCHAR(7) NOT NULL UNIQUE,      -- #06aaf5 形式
    name VARCHAR(50),                     -- 色名（任意）
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE ref.toggl_colors IS 'Toggl Track 無料プランで使用可能な色一覧';

-- Toggl Free Plan Colors (2024年時点、14色)
-- notion.gcal_mapping および画像から取得した実際の色
INSERT INTO ref.toggl_colors (hex, name, sort_order) VALUES
    -- Row 1
    ('#0b83d9', 'Blue', 1),
    ('#9e5bd9', 'Purple', 2),
    ('#d94182', 'Pink', 3),
    -- Row 2
    ('#2da608', 'Green', 4),
    ('#e36a00', 'Orange', 5),
    ('#bf7000', 'Brown', 6),
    -- Row 3
    ('#c7af14', 'Yellow', 7),
    ('#d92b2b', 'Red', 8),
    ('#06a893', 'Teal', 9),
    -- Row 4
    ('#c9806b', 'Peach', 10),
    ('#465bb3', 'Indigo', 11),
    ('#990099', 'Magenta', 12),
    -- Row 5
    ('#566614', 'Olive', 13),
    ('#525266', 'Gray', 14);

-- ============================================================================
-- Google Calendar Colors
-- ============================================================================
CREATE TABLE ref.gcalendar_colors (
    id VARCHAR(10) PRIMARY KEY,          -- Google Calendar の color_id (1-11)
    hex VARCHAR(7) NOT NULL,             -- 背景色
    name VARCHAR(50),                     -- 色名
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE ref.gcalendar_colors IS 'Google Calendar のイベント色一覧';

-- Google Calendar Event Colors (notion.gcal_mappingより実際の値)
INSERT INTO ref.gcalendar_colors (id, hex, name, sort_order) VALUES
    ('1', '#7986cb', 'Lavender', 1),
    ('2', '#33b679', 'Sage', 2),
    ('3', '#8e24aa', 'Grape', 3),
    ('4', '#e67c73', 'Flamingo', 4),
    ('5', '#f6bf26', 'Banana', 5),
    ('6', '#f4511e', 'Tangerine', 6),
    ('7', '#039be5', 'Peacock', 7),
    ('8', '#616161', 'Graphite', 8),
    ('9', '#3f51b5', 'Blueberry', 9),
    ('10', '#0b8043', 'Basil', 10),
    ('11', '#d50000', 'Tomato', 11);

-- ============================================================================
-- Color Mapping: Toggl ↔ Google Calendar
-- ============================================================================
CREATE TABLE ref.color_mapping (
    id SERIAL PRIMARY KEY,
    toggl_color_hex VARCHAR(7) NOT NULL REFERENCES ref.toggl_colors(hex),
    gcalendar_color_id VARCHAR(10) NOT NULL REFERENCES ref.gcalendar_colors(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(toggl_color_hex, gcalendar_color_id)
);

COMMENT ON TABLE ref.color_mapping IS 'Toggl と Google Calendar の色マッピング';

-- デフォルトマッピング（notion.gcal_mappingの実際のデータに基づく）
-- 使用中の色 (11色)
INSERT INTO ref.color_mapping (toggl_color_hex, gcalendar_color_id, notes) VALUES
    ('#0b83d9', '7', 'Blue → Peacock (reflect/管理)'),
    ('#2da608', '10', 'Green → Basil (study/勉強)'),
    ('#06a893', '2', 'Teal → Sage (household/用事)'),
    ('#c9806b', '4', 'Peach → Flamingo (nec/必須)'),
    ('#465bb3', '9', 'Indigo → Blueberry (work/仕事)'),
    ('#990099', '3', 'Magenta → Grape (free/余暇)'),
    ('#566614', '1', 'Olive → Lavender (drift/漂流)'),
    ('#525266', '8', 'Gray → Graphite (unused/未使用)'),
    ('#e36a00', '6', 'Orange → Tangerine (sleep/睡眠)'),
    ('#c7af14', '5', 'Yellow → Banana (exercise/運動)'),
    ('#d92b2b', '11', 'Red → Tomato (academic/学問)'),
    -- 未使用の色 (3色) - デフォルトマッピング
    ('#9e5bd9', '3', 'Purple → Grape'),
    ('#d94182', '4', 'Pink → Flamingo'),
    ('#bf7000', '6', 'Brown → Tangerine');
