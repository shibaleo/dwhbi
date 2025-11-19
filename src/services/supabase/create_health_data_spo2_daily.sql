-- SpO2（血中酸素濃度）
CREATE TABLE spo2_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  
  -- SpO2値（%）
  spo2_percent DECIMAL(5, 2),
  spo2_loinc TEXT DEFAULT '59408-5',
  
  -- 最小値・最大値
  spo2_min DECIMAL(5, 2),
  spo2_max DECIMAL(5, 2),
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spo2_date ON spo2_daily(date DESC);

COMMENT ON TABLE spo2_daily IS '血中酸素濃度データ';
COMMENT ON COLUMN spo2_daily.spo2_loinc IS 'LOINC: 59408-5 Oxygen saturation by Pulse oximetry';

ALTER TABLE spo2_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON spo2_daily
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON spo2_daily
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON spo2_daily
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON spo2_daily
  FOR DELETE USING (auth.role() = 'authenticated');