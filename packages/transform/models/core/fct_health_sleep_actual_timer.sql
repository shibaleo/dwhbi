-- fct_health_sleep_actual_timer.sql
-- =============================================================================
-- Daily sleep records aggregated from Toggl timer (manual tracking)
-- Features:
--   - Aggregates multiple Sleep entries per day into single record
--   - sleep_date = end_at(JST) - 1 day (sleep belongs to the night before)
--   - start_at/end_at: min/max of entries for that sleep_date
--   - UUID generated from sleep_date for stable PK
-- =============================================================================

with sleep_entries as (
    select
        source_id,
        start_at,
        end_at,
        duration_seconds,
        -- Sleep date: the day before the wake-up date (JST)
        ((end_at at time zone '{{ var("local_timezone") }}')::date - 1)::date as sleep_date
    from {{ ref('fct_time_records_actual') }}
    where project_name = 'Sleep'
),

aggregated as (
    select
        sleep_date,
        min(start_at) as start_at,
        max(end_at) as end_at,
        sum(duration_seconds)::integer as duration_seconds,
        array_agg(source_id order by start_at) as source_ids
    from sleep_entries
    group by sleep_date
)

select
    -- UUID v5 from namespace + sleep_date for deterministic PK
    md5('fct_health_sleep_actual_timer:' || sleep_date::text) as id,
    sleep_date,
    start_at,
    end_at,
    duration_seconds,
    source_ids
from aggregated
