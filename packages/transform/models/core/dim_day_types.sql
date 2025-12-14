-- dim_day_types.sql
-- =============================================================================
-- Day type dimension with day_type derived from time records
-- Features:
--   - day_type derived from fct_time_records_unified (hybrid logic)
--   - Work >= 5h → Work
--   - Drift >= 2h → Drift
--   - Otherwise: max duration category
-- =============================================================================

{% set work_threshold_hours = 5 %}
{% set drift_threshold_hours = 2 %}

with date_spine as (
    -- Generate dates from first record to 30 days in future
    select
        generate_series(
            (select min(start_at::date) from {{ ref('fct_time_records_unified') }}),
            current_date + interval '30 days',
            interval '1 day'
        )::date as date_day
),

daily_hours as (
    -- Aggregate hours by date and personal category
    select
        start_at::date as date_day,
        personal_category,
        sum(duration_seconds) / 3600.0 as total_hours
    from {{ ref('fct_time_records_unified') }}
    group by 1, 2
),

work_hours as (
    select date_day, total_hours
    from daily_hours
    where personal_category = 'Work'
),

drift_hours as (
    select date_day, total_hours
    from daily_hours
    where personal_category = 'Drift'
),

max_category as (
    -- Find the category with max hours
    select
        date_day,
        personal_category,
        total_hours,
        row_number() over (partition by date_day order by total_hours desc) as rn
    from daily_hours
)

select
    ds.date_day,
    -- Day of week (0=Sunday, 6=Saturday in PostgreSQL extract(dow))
    extract(dow from ds.date_day)::integer as day_of_week,
    extract(year from ds.date_day)::integer as year,
    extract(month from ds.date_day)::integer as month,
    extract(day from ds.date_day)::integer as day,
    -- ISO week number
    extract(week from ds.date_day)::integer as week_of_year,
    -- Hybrid logic for day_type
    case
        -- Step 1: Work >= 5h → Work
        when coalesce(wh.total_hours, 0) >= {{ work_threshold_hours }}
            then 'Work'
        -- Step 2: Drift >= 2h → Drift
        when coalesce(drh.total_hours, 0) >= {{ drift_threshold_hours }}
            then 'Drift'
        -- Step 3: max category (fallback)
        else coalesce(mc.personal_category, 'Unused')
    end as day_type,
    -- Total hours recorded
    coalesce(
        (select sum(total_hours) from daily_hours where date_day = ds.date_day),
        0
    ) as total_hours_recorded
from date_spine ds
left join work_hours wh on wh.date_day = ds.date_day
left join drift_hours drh on drh.date_day = ds.date_day
left join max_category mc on mc.date_day = ds.date_day and mc.rn = 1
