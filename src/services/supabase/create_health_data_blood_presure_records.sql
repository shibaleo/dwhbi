-- 血圧記録
CREATE TABLE blood_pressure_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measured_at TIMESTAMPTZ NOT NULL,
  
  -- 収縮期血圧（mmHg）
  systolic INTEGER NOT NULL,
  systolic_loinc TEXT DEFAULT '8480-6',
  
  -- 拡張期血圧（mmHg）
  diastolic INTEGER NOT NULL,
  diastolic_loinc TEXT DEFAULT '8462-4',
  
  -- 脈拍（bpm）- 血圧計で測定される場合
  pulse INTEGER,
  pulse_loinc TEXT DEFAULT '8867-4',
  
  -- 測定コンテキスト
  context TEXT, -- 'resting', 'morning', 'evening', 'after_exercise'
  
  -- 測定位置
  measurement_site TEXT, -- 'left_arm', 'right_arm', 'wrist'
  
  -- メモ
  notes TEXT,
  
  -- メタデータ
  source TEXT DEFAULT 'manual', -- 'manual', 'omron', 'tanita'
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bp_measured_at ON blood_pressure_records(measured_at DESC);

COMMENT ON TABLE blood_pressure_records IS '血圧測定記録（測定時ごと）';
COMMENT ON COLUMN blood_pressure_records.systolic_loinc IS 'LOINC: 8480-6 Systolic blood pressure';
COMMENT ON COLUMN blood_pressure_records.diastolic_loinc IS 'LOINC: 8462-4 Diastolic blood pressure';
COMMENT ON COLUMN blood_pressure_records.pulse_loinc IS 'LOINC: 8867-4 Heart rate';

ALTER TABLE blood_pressure_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON blood_pressure_records
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON blood_pressure_records
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON blood_pressure_records
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON blood_pressure_records
  FOR DELETE USING (auth.role() = 'authenticated');

ALTER TABLE blood_pressure_records
ADD CONSTRAINT blood_pressure_records_measured_at_source_key 
UNIQUE (measured_at, source);