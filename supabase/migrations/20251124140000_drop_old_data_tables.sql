-- =============================================================================
-- 旧スキーマのデータテーブル削除
-- =============================================================================
-- 
-- rawスキーマへの移行完了後、旧テーブルを削除
-- 
-- 残すテーブル（運用系）:
--   - fitbit.tokens
--   - tanita.tokens
--   - zaim.sync_log
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Toggl（全テーブル削除 → スキーマ削除）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS toggl.entries CASCADE;
DROP TABLE IF EXISTS toggl.tags CASCADE;
DROP TABLE IF EXISTS toggl.projects CASCADE;
DROP TABLE IF EXISTS toggl.clients CASCADE;
DROP SCHEMA IF EXISTS toggl CASCADE;

-- -----------------------------------------------------------------------------
-- Fitbit（tokensは残す）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS fitbit.activity_daily CASCADE;
DROP TABLE IF EXISTS fitbit.sleep CASCADE;
DROP TABLE IF EXISTS fitbit.heart_rate_daily CASCADE;
DROP TABLE IF EXISTS fitbit.hrv_daily CASCADE;
DROP TABLE IF EXISTS fitbit.spo2_daily CASCADE;
DROP TABLE IF EXISTS fitbit.breathing_rate_daily CASCADE;
DROP TABLE IF EXISTS fitbit.cardio_score_daily CASCADE;
DROP TABLE IF EXISTS fitbit.temperature_skin_daily CASCADE;
-- fitbit.tokens は残す

-- -----------------------------------------------------------------------------
-- Tanita（tokensは残す）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS tanita.body_composition CASCADE;
DROP TABLE IF EXISTS tanita.blood_pressure CASCADE;
DROP TABLE IF EXISTS tanita.steps CASCADE;
-- tanita.tokens は残す

-- -----------------------------------------------------------------------------
-- Zaim（sync_logは残す）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS zaim.transactions CASCADE;
DROP TABLE IF EXISTS zaim.genres CASCADE;
DROP TABLE IF EXISTS zaim.accounts CASCADE;
DROP TABLE IF EXISTS zaim.categories CASCADE;
-- zaim.sync_log は残す

-- -----------------------------------------------------------------------------
-- GCalendar（全テーブル削除 → スキーマ削除）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS gcalendar.events CASCADE;
DROP SCHEMA IF EXISTS gcalendar CASCADE;

-- -----------------------------------------------------------------------------
-- Notion（全テーブル削除 → スキーマ削除）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS notion.addiction CASCADE;
DROP TABLE IF EXISTS notion.sauna CASCADE;
DROP TABLE IF EXISTS notion.gcal_mapping CASCADE;
DROP SCHEMA IF EXISTS notion CASCADE;

-- -----------------------------------------------------------------------------
-- 完了メッセージ
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '=== Old data tables dropped ===';
  RAISE NOTICE 'Deleted schemas: toggl, gcalendar, notion';
  RAISE NOTICE 'Remaining tables: fitbit.tokens, tanita.tokens, zaim.sync_log';
  RAISE NOTICE 'All data now in raw schema';
END $$;
