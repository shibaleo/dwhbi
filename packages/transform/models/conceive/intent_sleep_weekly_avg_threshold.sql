-- intent_sleep_weekly_avg_threshold.sql
-- =============================================================================
-- 週平均睡眠時間の詳細データ（週単位）
--
-- 目標: 2025-08-01～2025-10-31の期間で、週平均睡眠時間が
--       7時間（420分）未満の週を全体の5%以下にする
-- 判定ロジックは可視化側で実装
-- =============================================================================

with daily_sleep as (
    -- 日別の睡眠時間を集計（分単位）
    select
        start_at::date as record_date,
        sum(duration_seconds) / 60.0 as duration_min
    from {{ ref('fct_time_records_actual') }}
    where personal_category = 'Sleep'
      and start_at::date between '2025-08-01' and '2025-10-31'
    group by 1
),

weekly_avg as (
    -- 週別の平均睡眠時間を計算
    select
        date_trunc('week', record_date)::date as week_start,
        date_trunc('week', record_date)::date + interval '6 days' as week_end,
        avg(duration_min) as avg_sleep_min,
        min(duration_min) as min_sleep_min,
        max(duration_min) as max_sleep_min,
        count(*) as days_with_data
    from daily_sleep
    group by 1, 2
)

-- 週単位の詳細データを返す
select
    week_start,
    week_end,
    round(avg_sleep_min, 1) as avg_sleep_min,
    round(avg_sleep_min / 60.0, 2) as avg_sleep_hours,
    round(min_sleep_min, 1) as min_sleep_min,
    round(max_sleep_min, 1) as max_sleep_min,
    days_with_data,
    420.0 as threshold_min,  -- 閾値（参照用）
    7.0 as threshold_hours   -- 閾値（参照用）
from weekly_avg
order by week_start
