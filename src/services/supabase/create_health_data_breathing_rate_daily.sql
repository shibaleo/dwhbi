-- 呼吸数（日次）
CREATE TABLE breathing_rate_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  
  -- 平均呼吸数（回/分）
  breathing_rate DECIMAL(4, 2),
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_breathing_date ON breathing_rate_daily(date DESC);

COMMENT ON TABLE breathing_rate_daily IS '日次呼吸数データ（睡眠中の平均）';

ALTER TABLE breathing_rate_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON breathing_rate_daily
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON breathing_rate_daily
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON breathing_rate_daily
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON breathing_rate_daily
  FOR DELETE USING (auth.role() = 'authenticated');