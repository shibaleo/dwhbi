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

-- Personal category master for coarse_category lookup and sort_order
mst_personal as (
    select
        name as personal_category,
        coarse_category,
        sort_order as personal_order
    from {{ ref('mst_personal_time_category') }}
),

-- Social category master for sort_order
mst_social as (
    select
        name as social_category,
        sort_order as social_order
    from {{ ref('mst_social_time_category') }}
),

-- Toggl projects master for sort_order (from Coda)
mst_projects as (
    select
        toggl_project_id,
        sort_order as project_order
    from {{ ref('mst_toggl_projects') }}
),

-- Coarse personal category master for sort_order
mst_coarse as (
    select
        name as coarse_category,
        sort_order as coarse_order
    from {{ ref('mst_coarse_personal_time_category') }}
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
        sr.project_id,
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
        coalesce(mcp.personal_category, 'Uncategorized') as personal_category,
        coalesce(mp.coarse_category, 'Uncategorized') as coarse_personal_category,
        -- Sort orders
        coalesce(ms.social_order, 999) as social_order,
        coalesce(mp.personal_order, 999) as personal_order,
        coalesce(mc.coarse_order, 999) as coarse_order
    from source_records sr
    left join projects p on p.project_id = sr.project_id
    left join clients c on c.client_id = p.client_id
    left join tag_names_agg tn on tn.time_entry_id = sr.time_entry_id
    left join map_color_to_personal mcp on mcp.toggl_color_hex = p.project_color
    left join map_client_to_social mcs on mcs.toggl_client_name = c.client_name
    left join mst_personal mp on mp.personal_category = mcp.personal_category
    left join mst_social ms on ms.social_category = coalesce(mcs.social_category, 'UNKNOWN')
    left join mst_coarse mc on mc.coarse_category = coalesce(mp.coarse_category, 'Uncategorized')
)

-- =============================================================================
-- Final output (filter out zero-duration entries)
-- =============================================================================
select
    er.source_id as id,
    er.source_id,
    er.start_at,
    er.end_at,
    extract(epoch from (er.end_at - er.start_at))::integer as duration_seconds,
    er.description,
    er.project_name,
    er.project_color,
    er.tag_names,
    er.social_category,
    er.personal_category,
    er.coarse_personal_category,
    er.social_order,
    er.personal_order,
    er.coarse_order,
    coalesce(mproj.project_order, 999) as project_order,
    'toggl_track' as source
from enriched_records er
left join mst_projects mproj on mproj.toggl_project_id = er.project_id
where er.start_at < er.end_at  -- Filter out zero-duration entries
