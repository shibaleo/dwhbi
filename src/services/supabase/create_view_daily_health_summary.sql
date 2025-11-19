-- 日次統合データビュー
CREATE OR REPLACE VIEW daily_health_summary AS
SELECT 
  dates.date,
  
  -- 体組成
  bm.weight_kg,
  bm.body_fat_percent,
  bm.bmi,
  
  -- 睡眠（メインスリープのみ）
  sr.total_minutes AS sleep_minutes,
  sr.deep_minutes AS sleep_deep_minutes,
  sr.light_minutes AS sleep_light_minutes,
  sr.rem_minutes AS sleep_rem_minutes,
  sr.efficiency_percent AS sleep_efficiency,
  
  -- 血圧（その日の最新測定値）
  bp_latest.systolic AS bp_systolic,
  bp_latest.diastolic AS bp_diastolic,
  bp_latest.pulse AS bp_pulse,
  bp_latest.measured_at AS bp_measured_at,
  
  -- 心拍数
  hr.resting_heart_rate,
  
  -- 活動量
  act.steps,
  act.distance_meters,
  act.calories_burned,
  act.very_active_minutes + act.fairly_active_minutes AS active_minutes,
  
  -- 呼吸数
  br.breathing_rate,
  
  -- SpO2
  spo2.spo2_percent,
  
  -- 体温
  temp.skin_temperature_celsius,
  
  -- 同期状態
  GREATEST(
    bm.synced_at, 
    sr.synced_at, 
    hr.synced_at, 
    act.synced_at,
    br.synced_at,
    spo2.synced_at,
    temp.synced_at,
    bp_latest.synced_at
  ) AS last_synced_at
  
FROM generate_series(
  '2023-01-01'::date,
  CURRENT_DATE,
  '1 day'::interval
) AS dates(date)

LEFT JOIN body_metrics_daily bm ON bm.date = dates.date
LEFT JOIN sleep_records sr ON sr.date = dates.date AND sr.is_main_sleep = true
LEFT JOIN heart_rate_daily hr ON hr.date = dates.date
LEFT JOIN activity_summary_daily act ON act.date = dates.date
LEFT JOIN breathing_rate_daily br ON br.date = dates.date
LEFT JOIN spo2_daily spo2 ON spo2.date = dates.date
LEFT JOIN temperature_daily temp ON temp.date = dates.date

-- その日の最新血圧測定値を取得
LEFT JOIN LATERAL (
  SELECT 
    systolic, 
    diastolic, 
    pulse,
    measured_at,
    synced_at
  FROM blood_pressure_records
  WHERE measured_at::date = dates.date
  ORDER BY measured_at DESC
  LIMIT 1
) bp_latest ON true

ORDER BY dates.date DESC;

COMMENT ON VIEW daily_health_summary IS '日次健康データ統合ビュー（Fitbit API + 血圧データ）';