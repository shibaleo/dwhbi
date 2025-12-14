-- fct_time_records_actual_split.sql
-- =============================================================================
-- Core fact table for actual time records (from Toggl) - DAY SPLIT VERSION
-- Features:
--   - JST 00:00:00 boundary day-splitting via recursive CTE
--   - Running records: end_at = CURRENT_TIMESTAMP (NOT NULL guaranteed)
--   - Category mapping from project color and client
--   - Zero-duration entries filtered out
--   - Output: UTC timestamptz for all timestamp columns
-- Use case: Daily aggregation, day-boundary analysis
-- =============================================================================

with recursive source_records as (
    select * from {{ ref('stg_toggl_track__time_entries') }}
),

projects as (
    select
        project_id,
        project_name,
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

tags as (
    select
        tag_id,
        tag_name
    from {{ ref('stg_toggl_track__tags') }}
),

-- Category mappings from ref layer
map_color_to_personal as (
    select
        toggl_color_hex,
        time_category_personal as personal_category
    from {{ ref('map_toggl_color_to_personal') }}
),

map_client_to_social as (
    select
        toggl_client_name,
        time_category_social as social_category
    from {{ ref('map_toggl_client_to_social') }}
),

-- =============================================================================
-- Enrich records with categories
-- =============================================================================
-- Convert tag_ids to tag_names array
tag_names_agg as (
    select
        sr.time_entry_id,
        array_agg(t.tag_name order by t.tag_name) filter (where t.tag_name is not null) as tag_names
    from source_records sr
    cross join lateral unnest(sr.tag_ids) as tid(tag_id)
    left join tags t on t.tag_id = tid.tag_id
    group by sr.time_entry_id
),

enriched_records as (
    select
        sr.time_entry_id::text as source_id,
        -- Keep original UTC timestamptz
        sr.started_at as start_at_utc,
        coalesce(sr.stopped_at, current_timestamp) as end_at_utc,
        -- Convert to JST for day-boundary splitting (timestamp without timezone)
        (sr.started_at at time zone 'Asia/Tokyo')::timestamp as start_jst,
        (coalesce(sr.stopped_at, current_timestamp) at time zone 'Asia/Tokyo')::timestamp as end_jst,
        sr.description,
        -- Project info
        p.project_name,
        p.project_color,
        -- Tags
        coalesce(tn.tag_names, array[]::text[]) as tag_names,
        -- Category mappings
        coalesce(mcs.social_category, 'UNKNOWN') as social_category,
        coalesce(mcp.personal_category, 'Uncategorized') as personal_category
    from source_records sr
    left join projects p on p.project_id = sr.project_id
    left join clients c on c.client_id = p.client_id
    left join tag_names_agg tn on tn.time_entry_id = sr.time_entry_id
    left join map_color_to_personal mcp on mcp.toggl_color_hex = p.project_color
    left join map_client_to_social mcs on mcs.toggl_client_name = c.client_name
    where sr.started_at < coalesce(sr.stopped_at, current_timestamp)  -- Filter out zero-duration entries
),

-- =============================================================================
-- Day-split using recursive CTE (JST 00:00:00 boundary)
-- Internal calculation uses JST timestamp for date boundary detection
-- =============================================================================
split_records as (
    -- Base case: original records
    select
        source_id,
        1 as split_index,
        start_jst,
        end_jst,
        description,
        project_name,
        project_color,
        tag_names,
        social_category,
        personal_category
    from enriched_records

    union all

    -- Recursive case: split at midnight JST
    select
        source_id,
        split_index + 1,
        (start_jst::date + interval '1 day')::timestamp as start_jst,
        end_jst,
        description,
        project_name,
        project_color,
        tag_names,
        social_category,
        personal_category
    from split_records
    where start_jst::date < end_jst::date  -- Still spans multiple days
)

-- =============================================================================
-- Final output with calculated duration
-- Convert JST back to UTC timestamptz for output
-- =============================================================================
select
    source_id || '_' || split_index as id,
    source_id,
    -- Convert JST timestamp back to UTC timestamptz
    (start_jst at time zone 'Asia/Tokyo')::timestamptz as start_at,
    (least(end_jst, (start_jst::date + interval '1 day')::timestamp) at time zone 'Asia/Tokyo')::timestamptz as end_at,
    extract(epoch from
        least(end_jst, (start_jst::date + interval '1 day')::timestamp) - start_jst
    )::integer as duration_seconds,
    description,
    project_name,
    project_color,
    tag_names,
    social_category,
    personal_category,
    'toggl_track' as source
from split_records
where start_jst < least(end_jst, (start_jst::date + interval '1 day')::timestamp)
