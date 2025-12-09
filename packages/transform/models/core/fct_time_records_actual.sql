-- fct_time_records_actual.sql
-- =============================================================================
-- Core fact table for actual time records (from Toggl)
-- Features:
--   - JST 00:00:00 boundary day-splitting via recursive CTE
--   - Running records: end_at = CURRENT_TIMESTAMP (NOT NULL guaranteed)
--   - Category mapping from project color and client
-- =============================================================================

with recursive source_records as (
    select * from {{ ref('stg_toggl_track__time_entries') }}
),

projects as (
    select
        project_id,
        client_id,
        color as project_color
    from {{ ref('stg_toggl_track__projects') }}
),

clients as (
    select
        client_id,
        client_name
    from {{ ref('stg_toggl_track__clients') }}
),

-- Category mappings from seeds
map_color_to_personal as (
    select
        toggl_color_hex,
        time_category_personal
    from {{ ref('map_toggl_color_to_time_personal') }}
),

map_client_to_social as (
    select
        toggl_client_name,
        time_category_social
    from {{ ref('map_toggl_client_to_time_social') }}
),

-- =============================================================================
-- Enrich records with categories
-- =============================================================================
enriched_records as (
    select
        sr.time_entry_id::text as source_id,
        -- Convert to JST (TIMESTAMP WITHOUT TIME ZONE)
        (sr.started_at at time zone 'Asia/Tokyo')::timestamp as start_jst,
        -- Running records: use CURRENT_TIMESTAMP; otherwise use stopped_at
        (coalesce(sr.stopped_at, current_timestamp) at time zone 'Asia/Tokyo')::timestamp as end_jst,
        sr.description,
        -- Category mappings
        coalesce(mcs.time_category_social, 'UNKNOWN') as time_category_social,
        coalesce(mcp.time_category_personal, 'Uncategorized') as time_category_personal
    from source_records sr
    left join projects p on p.project_id = sr.project_id
    left join clients c on c.client_id = p.client_id
    left join map_color_to_personal mcp on mcp.toggl_color_hex = p.project_color
    left join map_client_to_social mcs on mcs.toggl_client_name = c.client_name
),

-- =============================================================================
-- Day-split using recursive CTE (JST 00:00:00 boundary)
-- =============================================================================
split_records as (
    -- Base case: original records
    select
        source_id,
        1 as split_index,
        start_jst,
        end_jst,
        description,
        time_category_social,
        time_category_personal
    from enriched_records

    union all

    -- Recursive case: split at midnight JST
    select
        source_id,
        split_index + 1,
        (start_jst::date + interval '1 day')::timestamp as start_jst,
        end_jst,
        description,
        time_category_social,
        time_category_personal
    from split_records
    where start_jst::date < end_jst::date  -- Still spans multiple days
)

-- =============================================================================
-- Final output with calculated duration
-- =============================================================================
select
    source_id || '_' || split_index as id,
    source_id,
    start_jst as start_at,
    least(end_jst, (start_jst::date + interval '1 day')::timestamp) as end_at,
    extract(epoch from
        least(end_jst, (start_jst::date + interval '1 day')::timestamp) - start_jst
    )::integer as duration_seconds,
    description,
    time_category_social,
    time_category_personal,
    'toggl_track' as source
from split_records
where start_jst < least(end_jst, (start_jst::date + interval '1 day')::timestamp)
