-- 睡眠記録
CREATE TABLE sleep_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  
  -- 睡眠時間（分）
  total_minutes INTEGER,
  total_loinc TEXT DEFAULT '93832-4',
  
  -- 睡眠ステージ（分）
  deep_minutes INTEGER,
  deep_loinc TEXT DEFAULT '93831-6',
  light_minutes INTEGER,
  light_loinc TEXT DEFAULT '93830-8',
  rem_minutes INTEGER,
  rem_loinc TEXT DEFAULT '93829-0',
  awake_minutes INTEGER,
  
  -- 睡眠効率（%）
  efficiency_percent DECIMAL(5, 2),
  
  -- メインスリープフラグ
  is_main_sleep BOOLEAN DEFAULT true,
  
  -- ベッドにいた時間（分）
  time_in_bed_minutes INTEGER,
  
  -- 入眠潜時（分）
  minutes_to_fall_asleep INTEGER,
  
  -- 睡眠タイプ（stages or classic）
  sleep_type TEXT,
  
  -- 追加メタデータ
  metadata JSONB,
  
  -- メタデータ
  source TEXT DEFAULT 'fitbit',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(date, start_time)
);

CREATE INDEX idx_sleep_date ON sleep_records(date DESC);
CREATE INDEX idx_sleep_start_time ON sleep_records(start_time DESC);
CREATE INDEX idx_sleep_main ON sleep_records(is_main_sleep, date DESC);

COMMENT ON TABLE sleep_records IS '睡眠記録データ';
COMMENT ON COLUMN sleep_records.total_loinc IS 'LOINC: 93832-4 Sleep duration';
COMMENT ON COLUMN sleep_records.deep_loinc IS 'LOINC: 93831-6 Deep sleep duration';
COMMENT ON COLUMN sleep_records.light_loinc IS 'LOINC: 93830-8 Light sleep duration';
COMMENT ON COLUMN sleep_records.rem_loinc IS 'LOINC: 93829-0 REM sleep duration';

ALTER TABLE sleep_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON sleep_records
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON sleep_records
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON sleep_records
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON sleep_records
  FOR DELETE USING (auth.role() = 'authenticated');