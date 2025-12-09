-- fct_time_records_plan.sql
-- =============================================================================
-- Core fact table for plan time records (from Google Calendar)
-- Features:
--   - JST 00:00:00 boundary day-splitting via recursive CTE
--   - Category mapping from event color and description first line
-- =============================================================================

with recursive source_records as (
    select * from {{ ref('stg_google_calendar__events') }}
    where status != 'cancelled'  -- Exclude cancelled events
),

-- Category mappings from seeds
map_color_to_personal as (
    select
        gcal_color_id,
        time_category_personal
    from {{ ref('map_gcal_color_to_time_personal') }}
),

map_desc_to_social as (
    select
        gcal_description_first_line,
        time_category_social
    from {{ ref('map_gcal_desc_to_time_social') }}
),

-- =============================================================================
-- Enrich records with categories
-- =============================================================================
enriched_records as (
    select
        sr.event_id::text as source_id,
        -- Convert to JST (TIMESTAMP WITHOUT TIME ZONE)
        (sr.start_at at time zone 'Asia/Tokyo')::timestamp as start_jst,
        (sr.end_at at time zone 'Asia/Tokyo')::timestamp as end_jst,
        -- Map summary to description
        sr.summary as description,
        -- Category mappings
        coalesce(mds.time_category_social, 'UNKNOWN') as time_category_social,
        coalesce(mcp.time_category_personal, 'Uncategorized') as time_category_personal
    from source_records sr
    left join map_color_to_personal mcp on mcp.gcal_color_id = sr.color_id
    -- Extract first line of description for social category mapping
    left join map_desc_to_social mds
        on mds.gcal_description_first_line = split_part(sr.description, E'\n', 1)
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
    'google_calendar' as source
from split_records
where start_jst < least(end_jst, (start_jst::date + interval '1 day')::timestamp)
