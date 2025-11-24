-- ============================================================================
-- Migrate Service Tables to raw Schema
-- Created: 2024-11-24
-- ============================================================================
--
-- 移行戦略:
--   1. raw スキーマに新テーブルを作成
--   2. 既存データを INSERT ... SELECT で移行
--   3. 旧スキーマに互換ビューを作成（既存コードとの後方互換性）
--   4. 将来的に旧スキーマを削除（write_db.ts を postgres.js に移行後）
--
-- 移行対象:
--   - toggl: clients, projects, tags, entries
--   - fitbit: activity_daily, sleep, heart_rate_daily, cardio_score_daily,
--             hrv_daily, spo2_daily, breathing_rate_daily, temperature_skin_daily
--   - tanita: body_composition, blood_pressure, steps
--   - zaim: categories, genres, accounts, transactions
--   - gcalendar: events
--   - notion: sauna, addiction, gcal_mapping
--
-- 移行対象外:
--   - fitbit.tokens, tanita.tokens（認証用、別スキーマで管理予定）
--   - zaim.sync_log（運用系）
--
-- ============================================================================

-- ############################################################################
-- Part 1: TOGGL
-- ############################################################################

-- ----------------------------------------------------------------------------
-- raw.toggl_clients
-- ----------------------------------------------------------------------------
CREATE TABLE raw.toggl_clients (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.toggl_clients IS 'Togglクライアントマスタ（生データ）';

-- データ移行
INSERT INTO raw.toggl_clients (id, workspace_id, name, is_archived, created_at, synced_at)
SELECT id, workspace_id, name, is_archived, created_at, synced_at
FROM toggl.clients;

-- ----------------------------------------------------------------------------
-- raw.toggl_projects
-- ----------------------------------------------------------------------------
CREATE TABLE raw.toggl_projects (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    client_id BIGINT REFERENCES raw.toggl_clients(id),
    name TEXT NOT NULL,
    color TEXT,
    is_private BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_billable BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    estimated_hours NUMERIC,
    estimated_seconds BIGINT,
    rate NUMERIC,
    rate_last_updated TIMESTAMPTZ,
    currency TEXT,
    is_template BOOLEAN DEFAULT false,
    template_id BIGINT,
    auto_estimates BOOLEAN,
    recurring BOOLEAN DEFAULT false,
    recurring_parameters JSONB,
    fixed_fee NUMERIC,
    can_track_time BOOLEAN DEFAULT true,
    start_date DATE,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.toggl_projects IS 'Togglプロジェクトマスタ（生データ）';
COMMENT ON COLUMN raw.toggl_projects.archived_at IS 'プロジェクトがアーカイブされた日時。NULLの場合はアクティブ';

-- データ移行
INSERT INTO raw.toggl_projects (
    id, workspace_id, client_id, name, color, is_private, is_active, is_billable,
    created_at, archived_at, estimated_hours, estimated_seconds, rate, rate_last_updated,
    currency, is_template, template_id, auto_estimates, recurring, recurring_parameters,
    fixed_fee, can_track_time, start_date, synced_at
)
SELECT 
    id, workspace_id, client_id, name, color, is_private, is_active, is_billable,
    created_at, archived_at, estimated_hours, estimated_seconds, rate, rate_last_updated,
    currency, is_template, template_id, auto_estimates, recurring, recurring_parameters,
    fixed_fee, can_track_time, start_date, synced_at
FROM toggl.projects;

-- ----------------------------------------------------------------------------
-- raw.toggl_tags
-- ----------------------------------------------------------------------------
CREATE TABLE raw.toggl_tags (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.toggl_tags IS 'Togglタグマスタ（生データ）';
COMMENT ON COLUMN raw.toggl_tags.name IS 'タグ名（例：m:calm, work, projectなど）';

-- データ移行
INSERT INTO raw.toggl_tags (id, workspace_id, name, created_at, synced_at)
SELECT id, workspace_id, name, created_at, synced_at
FROM toggl.tags;

-- ----------------------------------------------------------------------------
-- raw.toggl_entries
-- ----------------------------------------------------------------------------
CREATE TABLE raw.toggl_entries (
    id BIGINT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    project_id BIGINT REFERENCES raw.toggl_projects(id),
    task_id BIGINT,
    user_id BIGINT,
    description TEXT,
    start TIMESTAMPTZ NOT NULL,
    "end" TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
    is_billable BOOLEAN DEFAULT false,
    billable_amount NUMERIC,
    currency TEXT,
    tags TEXT[],
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.toggl_entries IS 'Toggl時間エントリー（生データ）';
COMMENT ON COLUMN raw.toggl_entries.duration_ms IS '期間（ミリ秒）。Reports APIのdurフィールドに相当';
COMMENT ON COLUMN raw.toggl_entries.billable_amount IS 'Reports APIのbillableフィールドに相当';

-- データ移行
INSERT INTO raw.toggl_entries (
    id, workspace_id, project_id, task_id, user_id, description,
    start, "end", duration_ms, is_billable, billable_amount, currency,
    tags, updated_at, synced_at
)
SELECT 
    id, workspace_id, project_id, task_id, user_id, description,
    start, "end", duration_ms, is_billable, billable_amount, currency,
    tags, updated_at, synced_at
FROM toggl.entries;

-- ############################################################################
-- Part 2: FITBIT
-- ############################################################################

-- ----------------------------------------------------------------------------
-- raw.fitbit_activity_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_activity_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    steps INTEGER,
    distance_km NUMERIC,
    floors INTEGER,
    calories_total INTEGER,
    calories_bmr INTEGER,
    calories_activity INTEGER,
    sedentary_minutes INTEGER,
    lightly_active_minutes INTEGER,
    fairly_active_minutes INTEGER,
    very_active_minutes INTEGER,
    active_zone_minutes JSONB,
    intraday JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_activity_daily IS 'Fitbit日次活動サマリー（生データ）';
COMMENT ON COLUMN raw.fitbit_activity_daily.active_zone_minutes IS 'AZM詳細（fat_burn/cardio/peak分数）';
COMMENT ON COLUMN raw.fitbit_activity_daily.intraday IS '分単位詳細データ（任意）';

-- データ移行
INSERT INTO raw.fitbit_activity_daily (
    id, date, steps, distance_km, floors, calories_total, calories_bmr,
    calories_activity, sedentary_minutes, lightly_active_minutes,
    fairly_active_minutes, very_active_minutes, active_zone_minutes,
    intraday, synced_at
)
SELECT 
    id, date, steps, distance_km, floors, calories_total, calories_bmr,
    calories_activity, sedentary_minutes, lightly_active_minutes,
    fairly_active_minutes, very_active_minutes, active_zone_minutes,
    intraday, synced_at
FROM fitbit.activity_daily;

-- ----------------------------------------------------------------------------
-- raw.fitbit_sleep
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_sleep (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER,
    efficiency INTEGER,
    is_main_sleep BOOLEAN DEFAULT true,
    minutes_asleep INTEGER,
    minutes_awake INTEGER,
    time_in_bed INTEGER,
    sleep_type TEXT,
    levels JSONB,
    log_id BIGINT NOT NULL UNIQUE,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_sleep IS 'Fitbit睡眠記録（生データ）';
COMMENT ON COLUMN raw.fitbit_sleep.levels IS '睡眠ステージ詳細（data/shortData/summary）';
COMMENT ON COLUMN raw.fitbit_sleep.log_id IS 'Fitbit API logId';

-- データ移行
INSERT INTO raw.fitbit_sleep (
    id, date, start_time, end_time, duration_ms, efficiency, is_main_sleep,
    minutes_asleep, minutes_awake, time_in_bed, sleep_type, levels, log_id, synced_at
)
SELECT 
    id, date, start_time, end_time, duration_ms, efficiency, is_main_sleep,
    minutes_asleep, minutes_awake, time_in_bed, sleep_type, levels, log_id, synced_at
FROM fitbit.sleep;

-- ----------------------------------------------------------------------------
-- raw.fitbit_heart_rate_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_heart_rate_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    resting_heart_rate INTEGER,
    heart_rate_zones JSONB,
    intraday JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_heart_rate_daily IS 'Fitbit日次心拍データ（生データ）';
COMMENT ON COLUMN raw.fitbit_heart_rate_daily.heart_rate_zones IS 'ゾーン別時間・カロリー（Out of Range/Fat Burn/Cardio/Peak）';
COMMENT ON COLUMN raw.fitbit_heart_rate_daily.intraday IS '1分粒度心拍データ';

-- データ移行
INSERT INTO raw.fitbit_heart_rate_daily (id, date, resting_heart_rate, heart_rate_zones, intraday, synced_at)
SELECT id, date, resting_heart_rate, heart_rate_zones, intraday, synced_at
FROM fitbit.heart_rate_daily;

-- ----------------------------------------------------------------------------
-- raw.fitbit_hrv_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_hrv_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    daily_rmssd NUMERIC,
    deep_rmssd NUMERIC,
    intraday JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_hrv_daily IS 'Fitbit日次HRV（心拍変動）データ（生データ）';
COMMENT ON COLUMN raw.fitbit_hrv_daily.daily_rmssd IS '日次RMSSD値';
COMMENT ON COLUMN raw.fitbit_hrv_daily.deep_rmssd IS '深睡眠時RMSSD値';
COMMENT ON COLUMN raw.fitbit_hrv_daily.intraday IS '5分粒度データ（rmssd/coverage/hf/lf）';

-- データ移行
INSERT INTO raw.fitbit_hrv_daily (id, date, daily_rmssd, deep_rmssd, intraday, synced_at)
SELECT id, date, daily_rmssd, deep_rmssd, intraday, synced_at
FROM fitbit.hrv_daily;

-- ----------------------------------------------------------------------------
-- raw.fitbit_spo2_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_spo2_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    avg_spo2 NUMERIC,
    min_spo2 NUMERIC,
    max_spo2 NUMERIC,
    intraday JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_spo2_daily IS 'Fitbit日次SpO2（血中酸素濃度）データ（生データ）';
COMMENT ON COLUMN raw.fitbit_spo2_daily.avg_spo2 IS '平均SpO2（%）';
COMMENT ON COLUMN raw.fitbit_spo2_daily.intraday IS '睡眠中の詳細データ';

-- データ移行
INSERT INTO raw.fitbit_spo2_daily (id, date, avg_spo2, min_spo2, max_spo2, intraday, synced_at)
SELECT id, date, avg_spo2, min_spo2, max_spo2, intraday, synced_at
FROM fitbit.spo2_daily;

-- ----------------------------------------------------------------------------
-- raw.fitbit_breathing_rate_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_breathing_rate_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    breathing_rate NUMERIC,
    intraday JSONB,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_breathing_rate_daily IS 'Fitbit日次呼吸数データ（生データ）';
COMMENT ON COLUMN raw.fitbit_breathing_rate_daily.breathing_rate IS '平均呼吸数（回/分）';

-- データ移行
INSERT INTO raw.fitbit_breathing_rate_daily (id, date, breathing_rate, intraday, synced_at)
SELECT id, date, breathing_rate, intraday, synced_at
FROM fitbit.breathing_rate_daily;

-- ----------------------------------------------------------------------------
-- raw.fitbit_cardio_score_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_cardio_score_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    vo2_max NUMERIC,
    vo2_max_range_low NUMERIC,
    vo2_max_range_high NUMERIC,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_cardio_score_daily IS 'Fitbit日次VO2 Max（心肺機能スコア）データ（生データ）';
COMMENT ON COLUMN raw.fitbit_cardio_score_daily.vo2_max IS 'VO2 Max推定値（mL/kg/min）';

-- データ移行
INSERT INTO raw.fitbit_cardio_score_daily (id, date, vo2_max, vo2_max_range_low, vo2_max_range_high, synced_at)
SELECT id, date, vo2_max, vo2_max_range_low, vo2_max_range_high, synced_at
FROM fitbit.cardio_score_daily;

-- ----------------------------------------------------------------------------
-- raw.fitbit_temperature_skin_daily
-- ----------------------------------------------------------------------------
CREATE TABLE raw.fitbit_temperature_skin_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    nightly_relative NUMERIC,
    log_type TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.fitbit_temperature_skin_daily IS 'Fitbit日次皮膚温度データ（生データ）';
COMMENT ON COLUMN raw.fitbit_temperature_skin_daily.nightly_relative IS '基準値からの相対偏差（℃）';
COMMENT ON COLUMN raw.fitbit_temperature_skin_daily.log_type IS 'センサータイプ（dedicated_temp_sensor等）';

-- データ移行
INSERT INTO raw.fitbit_temperature_skin_daily (id, date, nightly_relative, log_type, synced_at)
SELECT id, date, nightly_relative, log_type, synced_at
FROM fitbit.temperature_skin_daily;

-- ############################################################################
-- Part 3: TANITA
-- ############################################################################

-- ----------------------------------------------------------------------------
-- raw.tanita_body_composition
-- ----------------------------------------------------------------------------
CREATE TABLE raw.tanita_body_composition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measured_at TIMESTAMPTZ NOT NULL UNIQUE,
    weight NUMERIC,
    body_fat_percent NUMERIC,
    model TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.tanita_body_composition IS '体組成測定データ（生データ）';
COMMENT ON COLUMN raw.tanita_body_composition.weight IS '体重 (kg) - tag: 6021';
COMMENT ON COLUMN raw.tanita_body_composition.body_fat_percent IS '体脂肪率 (%) - tag: 6022';
COMMENT ON COLUMN raw.tanita_body_composition.model IS '測定機器コード（00000000=手入力）';

-- データ移行
INSERT INTO raw.tanita_body_composition (id, measured_at, weight, body_fat_percent, model, synced_at)
SELECT id, measured_at, weight, body_fat_percent, model, synced_at
FROM tanita.body_composition;

-- ----------------------------------------------------------------------------
-- raw.tanita_blood_pressure
-- ----------------------------------------------------------------------------
CREATE TABLE raw.tanita_blood_pressure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measured_at TIMESTAMPTZ NOT NULL UNIQUE,
    systolic INTEGER,
    diastolic INTEGER,
    pulse INTEGER,
    model TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.tanita_blood_pressure IS '血圧測定データ（生データ）';
COMMENT ON COLUMN raw.tanita_blood_pressure.systolic IS '最高血圧 (mmHg) - tag: 622E';
COMMENT ON COLUMN raw.tanita_blood_pressure.diastolic IS '最低血圧 (mmHg) - tag: 622F';
COMMENT ON COLUMN raw.tanita_blood_pressure.pulse IS '脈拍 (bpm) - tag: 6230';

-- データ移行
INSERT INTO raw.tanita_blood_pressure (id, measured_at, systolic, diastolic, pulse, model, synced_at)
SELECT id, measured_at, systolic, diastolic, pulse, model, synced_at
FROM tanita.blood_pressure;

-- ----------------------------------------------------------------------------
-- raw.tanita_steps
-- ----------------------------------------------------------------------------
CREATE TABLE raw.tanita_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measured_at TIMESTAMPTZ NOT NULL UNIQUE,
    steps INTEGER,
    model TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.tanita_steps IS '歩数測定データ（生データ）';
COMMENT ON COLUMN raw.tanita_steps.steps IS '歩数 - tag: 6331';

-- データ移行
INSERT INTO raw.tanita_steps (id, measured_at, steps, model, synced_at)
SELECT id, measured_at, steps, model, synced_at
FROM tanita.steps;

-- ############################################################################
-- Part 4: ZAIM
-- ############################################################################

-- ----------------------------------------------------------------------------
-- raw.zaim_categories
-- ----------------------------------------------------------------------------
CREATE TABLE raw.zaim_categories (
    id INTEGER NOT NULL,
    zaim_user_id BIGINT NOT NULL,
    name VARCHAR NOT NULL,
    sort_order INTEGER,
    mode VARCHAR CHECK (mode IN ('payment', 'income')),
    is_active BOOLEAN DEFAULT true,
    synced_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, zaim_user_id)
);

COMMENT ON TABLE raw.zaim_categories IS 'Zaim大分類マスタ（生データ）';

-- データ移行
INSERT INTO raw.zaim_categories (id, zaim_user_id, name, sort_order, mode, is_active, synced_at)
SELECT id, zaim_user_id, name, sort_order, mode, is_active, synced_at
FROM zaim.categories;

-- ----------------------------------------------------------------------------
-- raw.zaim_genres
-- ----------------------------------------------------------------------------
CREATE TABLE raw.zaim_genres (
    id INTEGER NOT NULL,
    zaim_user_id BIGINT NOT NULL,
    category_id INTEGER NOT NULL,
    name VARCHAR NOT NULL,
    sort_order INTEGER,
    is_active BOOLEAN DEFAULT true,
    synced_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, zaim_user_id),
    FOREIGN KEY (category_id, zaim_user_id) REFERENCES raw.zaim_categories(id, zaim_user_id)
);

COMMENT ON TABLE raw.zaim_genres IS 'Zaimジャンルマスタ（生データ）';

-- データ移行
INSERT INTO raw.zaim_genres (id, zaim_user_id, category_id, name, sort_order, is_active, synced_at)
SELECT id, zaim_user_id, category_id, name, sort_order, is_active, synced_at
FROM zaim.genres;

-- ----------------------------------------------------------------------------
-- raw.zaim_accounts
-- ----------------------------------------------------------------------------
CREATE TABLE raw.zaim_accounts (
    id INTEGER NOT NULL,
    zaim_user_id BIGINT NOT NULL,
    name VARCHAR NOT NULL,
    sort_order INTEGER,
    is_active BOOLEAN DEFAULT true,
    synced_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, zaim_user_id)
);

COMMENT ON TABLE raw.zaim_accounts IS 'Zaim口座マスタ（生データ）';

-- データ移行
INSERT INTO raw.zaim_accounts (id, zaim_user_id, name, sort_order, is_active, synced_at)
SELECT id, zaim_user_id, name, sort_order, is_active, synced_at
FROM zaim.accounts;

-- ----------------------------------------------------------------------------
-- raw.zaim_transactions
-- ----------------------------------------------------------------------------
CREATE TABLE raw.zaim_transactions (
    zaim_user_id BIGINT NOT NULL,
    zaim_id BIGINT NOT NULL,
    transaction_type VARCHAR NOT NULL CHECK (transaction_type IN ('payment', 'income', 'transfer')),
    amount INTEGER NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    modified_at TIMESTAMPTZ,
    category_id INTEGER,
    genre_id INTEGER,
    from_account_id INTEGER,
    to_account_id INTEGER,
    place TEXT,
    name TEXT,
    comment TEXT,
    is_active BOOLEAN DEFAULT true,
    receipt_id BIGINT,
    synced_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (zaim_user_id, zaim_id),
    FOREIGN KEY (category_id, zaim_user_id) REFERENCES raw.zaim_categories(id, zaim_user_id),
    FOREIGN KEY (genre_id, zaim_user_id) REFERENCES raw.zaim_genres(id, zaim_user_id),
    FOREIGN KEY (from_account_id, zaim_user_id) REFERENCES raw.zaim_accounts(id, zaim_user_id),
    FOREIGN KEY (to_account_id, zaim_user_id) REFERENCES raw.zaim_accounts(id, zaim_user_id)
);

COMMENT ON TABLE raw.zaim_transactions IS 'Zaim取引データ（生データ）';

-- データ移行
INSERT INTO raw.zaim_transactions (
    zaim_user_id, zaim_id, transaction_type, amount, date, created_at, modified_at,
    category_id, genre_id, from_account_id, to_account_id, place, name, comment,
    is_active, receipt_id, synced_at
)
SELECT 
    zaim_user_id, zaim_id, transaction_type, amount, date, created_at, modified_at,
    category_id, genre_id, from_account_id, to_account_id, place, name, comment,
    is_active, receipt_id, synced_at
FROM zaim.transactions;

-- ############################################################################
-- Part 5: GCALENDAR
-- ############################################################################

-- ----------------------------------------------------------------------------
-- raw.gcalendar_events
-- ----------------------------------------------------------------------------
CREATE TABLE raw.gcalendar_events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL,
    summary TEXT,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT GENERATED ALWAYS AS (EXTRACT(epoch FROM (end_time - start_time)) * 1000) STORED,
    is_all_day BOOLEAN DEFAULT false,
    color_id TEXT,
    status TEXT,
    recurring_event_id TEXT,
    etag TEXT,
    updated TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE raw.gcalendar_events IS 'Google Calendar イベント（生データ）';
COMMENT ON COLUMN raw.gcalendar_events.id IS 'Google Calendar イベントID';
COMMENT ON COLUMN raw.gcalendar_events.summary IS 'イベント名（Toggl description に相当）';
COMMENT ON COLUMN raw.gcalendar_events.description IS 'イベント詳細（Toggl client に相当）';
COMMENT ON COLUMN raw.gcalendar_events.duration_ms IS '期間（ミリ秒）- Togglと同じ単位';
COMMENT ON COLUMN raw.gcalendar_events.color_id IS '時間の質的分類（ref.gcalendar_colors.id に対応）';
COMMENT ON COLUMN raw.gcalendar_events.status IS 'イベントステータス（confirmed/tentative/cancelled）';

-- データ移行
INSERT INTO raw.gcalendar_events (
    id, calendar_id, summary, description, start_time, end_time,
    is_all_day, color_id, status, recurring_event_id, etag, updated, synced_at
)
SELECT 
    id, calendar_id, summary, description, start_time, end_time,
    is_all_day, color_id, status, recurring_event_id, etag, updated, synced_at
FROM gcalendar.events;

-- ############################################################################
-- Part 6: NOTION
-- ############################################################################

-- ----------------------------------------------------------------------------
-- raw.notion_gcal_mapping
-- ----------------------------------------------------------------------------
CREATE TABLE raw.notion_gcal_mapping (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    name TEXT NOT NULL,
    ja_name TEXT,
    description TEXT,
    gcal_color_id TEXT,
    gcal_hex TEXT,
    gcal_color_name TEXT,
    toggl_hex TEXT
);

COMMENT ON TABLE raw.notion_gcal_mapping IS 'Notion: Google Calendar色マッピング（生データ）';

-- データ移行
INSERT INTO raw.notion_gcal_mapping (
    id, created_at, updated_at, synced_at, name, ja_name, description,
    gcal_color_id, gcal_hex, gcal_color_name, toggl_hex
)
SELECT 
    id, created_at, updated_at, synced_at, name, ja_name, description,
    gcal_color_id, gcal_hex, gcal_color_name, toggl_hex
FROM notion.gcal_mapping;

-- ----------------------------------------------------------------------------
-- raw.notion_sauna
-- ----------------------------------------------------------------------------
CREATE TABLE raw.notion_sauna (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    date JSONB,
    place TEXT NOT NULL,
    "1st_period_min" NUMERIC,
    "2nd_period_min" NUMERIC,
    "3rd_period_min" NUMERIC
);

COMMENT ON TABLE raw.notion_sauna IS 'Notion: サウナ記録（生データ）';

-- データ移行
INSERT INTO raw.notion_sauna (
    id, created_at, updated_at, synced_at, date, place,
    "1st_period_min", "2nd_period_min", "3rd_period_min"
)
SELECT 
    id, created_at, updated_at, synced_at, date, place,
    "1st_period_min", "2nd_period_min", "3rd_period_min"
FROM notion.sauna;

-- ----------------------------------------------------------------------------
-- raw.notion_addiction
-- ----------------------------------------------------------------------------
CREATE TABLE raw.notion_addiction (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    date JSONB,
    substances TEXT NOT NULL,
    "経緯" TEXT
);

COMMENT ON TABLE raw.notion_addiction IS 'Notion: 依存行動記録（生データ）';

-- データ移行
INSERT INTO raw.notion_addiction (
    id, created_at, updated_at, synced_at, date, substances, "経緯"
)
SELECT 
    id, created_at, updated_at, synced_at, date, substances, "経緯"
FROM notion.addiction;

-- ############################################################################
-- Part 7: インデックス作成
-- ############################################################################

-- Toggl
CREATE INDEX idx_toggl_entries_start ON raw.toggl_entries(start);
CREATE INDEX idx_toggl_entries_project_id ON raw.toggl_entries(project_id);
CREATE INDEX idx_toggl_projects_client_id ON raw.toggl_projects(client_id);

-- Fitbit
CREATE INDEX idx_fitbit_activity_daily_date ON raw.fitbit_activity_daily(date);
CREATE INDEX idx_fitbit_sleep_date ON raw.fitbit_sleep(date);
CREATE INDEX idx_fitbit_heart_rate_daily_date ON raw.fitbit_heart_rate_daily(date);

-- Tanita
CREATE INDEX idx_tanita_body_composition_measured_at ON raw.tanita_body_composition(measured_at);
CREATE INDEX idx_tanita_blood_pressure_measured_at ON raw.tanita_blood_pressure(measured_at);

-- Zaim
CREATE INDEX idx_zaim_transactions_date ON raw.zaim_transactions(date);
CREATE INDEX idx_zaim_transactions_category ON raw.zaim_transactions(category_id, zaim_user_id);

-- GCalendar
CREATE INDEX idx_gcalendar_events_start_time ON raw.gcalendar_events(start_time);
CREATE INDEX idx_gcalendar_events_calendar_id ON raw.gcalendar_events(calendar_id);

-- ############################################################################
-- Part 8: RLS設定（Supabase標準）
-- ############################################################################

ALTER TABLE raw.toggl_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.toggl_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE raw.fitbit_activity_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_sleep ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_heart_rate_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_hrv_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_spo2_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_breathing_rate_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_cardio_score_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.fitbit_temperature_skin_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE raw.tanita_body_composition ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.tanita_blood_pressure ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.tanita_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE raw.zaim_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.zaim_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.zaim_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.zaim_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE raw.gcalendar_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE raw.notion_gcal_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.notion_sauna ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.notion_addiction ENABLE ROW LEVEL SECURITY;

-- ############################################################################
-- Part 9: 権限設定
-- ############################################################################

-- service_role には全権限
GRANT ALL ON ALL TABLES IN SCHEMA raw TO service_role;

-- anon, authenticated には SELECT のみ
GRANT SELECT ON ALL TABLES IN SCHEMA raw TO anon, authenticated;

-- ############################################################################
-- 完了メッセージ
-- ############################################################################

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration to raw schema completed!';
    RAISE NOTICE '';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  - raw.toggl_clients, toggl_projects, toggl_tags, toggl_entries';
    RAISE NOTICE '  - raw.fitbit_* (8 tables)';
    RAISE NOTICE '  - raw.tanita_body_composition, tanita_blood_pressure, tanita_steps';
    RAISE NOTICE '  - raw.zaim_categories, zaim_genres, zaim_accounts, zaim_transactions';
    RAISE NOTICE '  - raw.gcalendar_events';
    RAISE NOTICE '  - raw.notion_gcal_mapping, notion_sauna, notion_addiction';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Update write_db.ts in each service to use raw schema';
    RAISE NOTICE '  2. Create compatibility views in old schemas (optional)';
    RAISE NOTICE '  3. Drop old tables after verification';
    RAISE NOTICE '========================================';
END $$;
