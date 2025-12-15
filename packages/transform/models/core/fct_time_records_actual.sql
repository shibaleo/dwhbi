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

-- Core master: Toggl projects + Coda metadata (includes sort_order, client_name)
projects as (
    select
        project_id,
        project_name,
        project_color,
        client_name,
        sort_order as project_order
    from {{ ref('mst_time_projects') }}
),

tags as (
    select
        tag_id,
        tag_name
    from {{ ref('stg_toggl_track__tags') }}
),

-- Core master: Personal time categories + color mapping (includes sort_order)
-- Unnest color_hex_codes to enable join by project_color
mst_personal_colors as (
    select
        mp.name as personal_category,
        mp.coarse_category,
        mp.sort_order as personal_order,
        unnest(mp.color_hex_codes) as toggl_color_hex
    from {{ ref('mst_personal_time_category') }} mp
),

-- Core master: Social time categories + client mapping (includes sort_order)
-- Unnest client_names to enable join by client_name
mst_social_clients as (
    select
        ms.name as social_category,
        ms.sort_order as social_order,
        unnest(ms.client_names) as client_name
    from {{ ref('mst_social_time_category') }} ms
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
        -- Keep original UTC timestamptz
        sr.started_at as start_at,
        coalesce(sr.stopped_at, current_timestamp) as end_at,
        sr.description,
        -- Project info (from core.mst_time_projects)
        p.project_name,
        p.project_color,
        coalesce(p.project_order, 999) as project_order,
        -- Tags
        coalesce(tn.tag_names, array[]::text[]) as tag_names,
        -- Category mappings (via core masters only)
        coalesce(msc.social_category, 'UNKNOWN') as social_category,
        coalesce(mpc.personal_category, 'Uncategorized') as personal_category,
        coalesce(mpc.coarse_category, 'Uncategorized') as coarse_personal_category,
        -- Sort orders (from core masters)
        coalesce(msc.social_order, 999) as social_order,
        coalesce(mpc.personal_order, 999) as personal_order,
        coalesce(mc.coarse_order, 999) as coarse_order
    from source_records sr
    left join projects p on p.project_id = sr.project_id
    left join tag_names_agg tn on tn.time_entry_id = sr.time_entry_id
    -- Personal category via color mapping (from core.mst_personal_time_category)
    left join mst_personal_colors mpc on mpc.toggl_color_hex = p.project_color
    -- Social category via client mapping (from core.mst_social_time_category)
    left join mst_social_clients msc on msc.client_name = p.client_name
    left join mst_coarse mc on mc.coarse_category = coalesce(mpc.coarse_category, 'Uncategorized')
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
    coarse_personal_category,
    social_order,
    personal_order,
    coarse_order,
    project_order,
    'toggl_track' as source
from enriched_records
where start_at < end_at  -- Filter out zero-duration entries
