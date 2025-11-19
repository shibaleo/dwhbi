-- 体組成データ（日次測定）
CREATE TABLE body_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  
  -- 体重
  weight_kg DECIMAL(5, 2),
  weight_loinc TEXT DEFAULT '29463-7',
  
  -- 体脂肪率
  body_fat_percent DECIMAL(4, 2),
  body_fat_loinc TEXT DEFAULT '41982-0',
  
  -- BMI（Fitbit APIから取得）
  bmi DECIMAL(4, 2),
  bmi_loinc TEXT DEFAULT '39156-5',
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_body_metrics_date ON body_metrics_daily(date DESC);

COMMENT ON TABLE body_metrics_daily IS '日次体組成データ（体重、体脂肪率、BMI）';
COMMENT ON COLUMN body_metrics_daily.weight_loinc IS 'LOINC: 29463-7 Body weight Measured';
COMMENT ON COLUMN body_metrics_daily.body_fat_loinc IS 'LOINC: 41982-0 Percentage of body fat Measured';
COMMENT ON COLUMN body_metrics_daily.bmi_loinc IS 'LOINC: 39156-5 Body mass index';

ALTER TABLE body_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON body_metrics_daily
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON body_metrics_daily
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON body_metrics_daily
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON body_metrics_daily
  FOR DELETE USING (auth.role() = 'authenticated');