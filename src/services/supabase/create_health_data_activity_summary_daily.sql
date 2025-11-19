-- 活動量サマリー（日次集計）
CREATE TABLE activity_summary_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  
  -- 歩数
  steps INTEGER,
  steps_loinc TEXT DEFAULT '41950-7',
  
  -- 距離（メートル）
  distance_meters INTEGER,
  
  -- 消費カロリー
  calories_burned INTEGER,
  calories_loinc TEXT DEFAULT '41981-2',
  
  -- 基礎代謝カロリー
  calories_bmr INTEGER,
  
  -- 活動カロリー
  activity_calories INTEGER,
  
  -- アクティブ時間（分）
  sedentary_minutes INTEGER,
  lightly_active_minutes INTEGER,
  fairly_active_minutes INTEGER,
  very_active_minutes INTEGER,
  
  -- 階数
  floors INTEGER,
  
  -- 標高（メートル）
  elevation_meters DECIMAL(6, 2),
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_date ON activity_summary_daily(date DESC);

COMMENT ON TABLE activity_summary_daily IS '日次活動量サマリー（歩数、距離、カロリーなど）';
COMMENT ON COLUMN activity_summary_daily.steps_loinc IS 'LOINC: 41950-7 Number of steps in 24 hour';
COMMENT ON COLUMN activity_summary_daily.calories_loinc IS 'LOINC: 41981-2 Calories burned';

ALTER TABLE activity_summary_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON activity_summary_daily
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON activity_summary_daily
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON activity_summary_daily
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON activity_summary_daily
  FOR DELETE USING (auth.role() = 'authenticated');