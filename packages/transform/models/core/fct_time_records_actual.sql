-- fct_time_records_actual.sql
-- =============================================================================
-- Core fact table for actual time records (from Toggl) - ENTRY LEVEL
-- Features:
--   - Original entries without day-splitting
--   - Running records: end_at = CURRENT_TIMESTAMP (NOT NULL guaranteed)
--   - Category mapping from project color and client
--   - Zero-duration entries filtered out
--   - Output: UTC timestamptz for all timestamp columns
-- Use case: Entry-level analysis, sleep tracking, session duration analysis
-- =============================================================================

with source_records as (
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
        sr.started_at as start_at,
        coalesce(sr.stopped_at, current_timestamp) as end_at,
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
)

-- =============================================================================
-- Final output (filter out zero-duration entries)
-- =============================================================================
select
    source_id as id,
    source_id,
    start_at,
    end_at,
    extract(epoch from (end_at - start_at))::integer as duration_seconds,
    description,
    project_name,
    project_color,
    tag_names,
    social_category,
    personal_category,
    'toggl_track' as source
from enriched_records
where start_at < end_at  -- Filter out zero-duration entries
