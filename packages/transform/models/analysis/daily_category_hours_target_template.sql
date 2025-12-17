-- daily_category_hours_target_template.sql
-- =============================================================================
-- Analysis: Target time templates (weekday/holiday patterns)
-- Extracts one weekday and one holiday pattern from fct_time_records_target_split
-- =============================================================================

with daily_agg as (
    select
        (start_at at time zone '{{ var("local_timezone") }}')::date as date,
        personal_category,
        sum(duration_seconds) / 3600.0 as hours
    from {{ ref('fct_time_records_target_split') }}
    group by 1, 2
),

-- Calculate total hours per date to filter incomplete days
daily_totals as (
    select
        date,
        sum(hours) as total_hours
    from daily_agg
    group by date
    having sum(hours) >= 20  -- Filter out incomplete days (< 20 hours)
),

-- Determine day type for each complete date
dates_with_type as (
    select distinct
        d.date,
        extract(dow from d.date)::integer as day_of_week,
        case when extract(dow from d.date) in (0, 6) then 'holiday' else 'weekday' end as day_type
    from daily_totals d
),

-- Pick one representative date for each day_type
-- (use min date to get a consistent sample from complete days)
representative_dates as (
    select
        day_type,
        min(date) as sample_date
    from dates_with_type
    group by day_type
),

-- Get all categories from dimension
categories as (
    select name as personal_category, sort_order
    from {{ ref('dim_category_time_personal') }}
),

-- Cross join to ensure all category combinations exist for each day_type
template_base as (
    select
        r.day_type,
        r.sample_date,
        c.personal_category,
        c.sort_order
    from representative_dates r
    cross join categories c
),

-- Join with actual target data
filled as (
    select
        t.day_type,
        t.personal_category,
        t.sort_order,
        coalesce(a.hours, 0) as hours
    from template_base t
    left join daily_agg a
        on t.sample_date = a.date
        and t.personal_category = a.personal_category
)

-- Pivot to wide format (one row per day_type)
select
    day_type,
    max(case when personal_category = 'Vitals' then hours else 0 end) as vitals_hours,
    max(case when personal_category = 'Sleep' then hours else 0 end) as sleep_hours,
    max(case when personal_category = 'Exercise' then hours else 0 end) as exercise_hours,
    max(case when personal_category = 'Overhead' then hours else 0 end) as overhead_hours,
    max(case when personal_category = 'Work' then hours else 0 end) as work_hours,
    max(case when personal_category = 'Education' then hours else 0 end) as education_hours,
    max(case when personal_category = 'Creative' then hours else 0 end) as creative_hours,
    max(case when personal_category = 'Social' then hours else 0 end) as social_hours,
    max(case when personal_category = 'Meta' then hours else 0 end) as meta_hours,
    max(case when personal_category = 'Pleasure' then hours else 0 end) as pleasure_hours,
    sum(hours) as total_hours
from filled
group by day_type
order by day_type
