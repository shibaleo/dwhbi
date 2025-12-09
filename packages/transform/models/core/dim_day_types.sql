-- dim_day_types.sql
-- =============================================================================
-- Day type dimension with day_type derived from time records
-- Features:
--   - day_type derived from fct_time_records_unified (hybrid logic)
--   - Work >= 5h → Work
--   - Drift >= 2h → Drift
--   - Otherwise: max duration among eligible categories
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
        time_category_personal,
        sum(duration_seconds) / 3600.0 as total_hours
    from {{ ref('fct_time_records_unified') }}
    group by 1, 2
),

eligible_categories as (
    -- Categories eligible for day_type determination
    select name as time_category_personal
    from {{ ref('mst_time_personal_categories') }}
    where is_day_type_eligible = true
),

work_hours as (
    select date_day, total_hours
    from daily_hours
    where time_category_personal = 'Work'
),

drift_hours as (
    select date_day, total_hours
    from daily_hours
    where time_category_personal = 'Drift'
),

max_eligible as (
    -- Find the category with max hours among eligible categories
    select
        dh.date_day,
        dh.time_category_personal,
        dh.total_hours,
        row_number() over (partition by dh.date_day order by dh.total_hours desc) as rn
    from daily_hours dh
    inner join eligible_categories ec
        on dh.time_category_personal = ec.time_category_personal
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
        -- Step 3: max eligible category (fallback)
        else coalesce(me.time_category_personal, 'Unused')
    end as day_type,
    -- Total hours recorded
    coalesce(
        (select sum(total_hours) from daily_hours where date_day = ds.date_day),
        0
    ) as total_hours_recorded
from date_spine ds
left join work_hours wh on wh.date_day = ds.date_day
left join drift_hours drh on drh.date_day = ds.date_day
left join max_eligible me on me.date_day = ds.date_day and me.rn = 1
