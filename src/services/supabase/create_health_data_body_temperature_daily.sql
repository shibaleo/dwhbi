-- 体温データ（日次）
CREATE TABLE body_temperature_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  
  -- 皮膚温度（相対値、摂氏）
  skin_temperature_celsius DECIMAL(4, 2),
  
  -- コア体温（相対値、摂氏）
  core_temperature_celsius DECIMAL(4, 2),
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_body_temperature_date ON body_temperature_daily(date DESC);

COMMENT ON TABLE body_temperature_daily IS '日次体温データ（相対値）';

ALTER TABLE body_temperature_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON body_temperature_daily
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON body_temperature_daily
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON body_temperature_daily
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON body_temperature_daily
  FOR DELETE USING (auth.role() = 'authenticated');
