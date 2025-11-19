-- ==========================================
-- 血圧週次平均ビュー
-- ==========================================
CREATE OR REPLACE VIEW blood_pressure_weekly_avg AS
SELECT 
  DATE_TRUNC('week', measured_at)::date AS week_start,
  ROUND(AVG(systolic), 1) AS avg_systolic,
  ROUND(AVG(diastolic), 1) AS avg_diastolic,
  ROUND(AVG(pulse), 1) AS avg_pulse,
  COUNT(*) AS measurement_count,
  MIN(measured_at) AS first_measurement,
  MAX(measured_at) AS last_measurement
FROM blood_pressure_records
GROUP BY DATE_TRUNC('week', measured_at)
ORDER BY week_start DESC;

COMMENT ON VIEW blood_pressure_weekly_avg IS '週次血圧平均値';