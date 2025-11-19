-- 心拍数データ（日次サマリー）
CREATE TABLE heart_rate_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  
  -- 安静時心拍数
  resting_heart_rate INTEGER,
  resting_hr_loinc TEXT DEFAULT '40443-4',
  
  -- 心拍ゾーン別時間（分）
  out_of_range_minutes INTEGER,
  fat_burn_minutes INTEGER,
  cardio_minutes INTEGER,
  peak_minutes INTEGER,
  
  -- 心拍ゾーン詳細（JSONB）
  heart_rate_zones JSONB,
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_heart_rate_date ON heart_rate_daily(date DESC);

COMMENT ON TABLE heart_rate_daily IS '日次心拍数データ';
COMMENT ON COLUMN heart_rate_daily.resting_hr_loinc IS 'LOINC: 40443-4 Heart rate --resting';

ALTER TABLE heart_rate_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON heart_rate_daily
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON heart_rate_daily
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON heart_rate_daily
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON heart_rate_daily
  FOR DELETE USING (auth.role() = 'authenticated');