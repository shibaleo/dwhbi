-- daily_category_hours_actual.sql
-- =============================================================================
-- Analysis: Daily category-wise hours from actual time records
-- Pivots time entries into a single row per date with 10 category columns
-- =============================================================================

with daily_agg as (
    select
        (start_at at time zone '{{ var("local_timezone") }}')::date as date,
        personal_category,
        sum(duration_seconds) / 3600.0 as hours
    from {{ ref('fct_time_records_actual_split') }}
    group by 1, 2
),

-- Get all dates with any data
dates as (
    select distinct date from daily_agg
),

-- Get all categories from dimension
categories as (
    select name as personal_category, sort_order
    from {{ ref('dim_category_time_personal') }}
),

-- Cross join to ensure all date-category combinations exist
date_category_matrix as (
    select
        d.date,
        c.personal_category,
        c.sort_order
    from dates d
    cross join categories c
),

-- Join with actual data, default to 0 for missing categories
filled as (
    select
        m.date,
        m.personal_category,
        m.sort_order,
        coalesce(a.hours, 0) as hours
    from date_category_matrix m
    left join daily_agg a
        on m.date = a.date
        and m.personal_category = a.personal_category
)

-- Pivot to wide format (one row per date, one column per category)
select
    date,
    extract(dow from date)::integer as day_of_week,  -- 0=Sun, 1=Mon, ..., 6=Sat
    case when extract(dow from date) in (0, 6) then 'holiday' else 'weekday' end as day_type,
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
group by date
order by date
