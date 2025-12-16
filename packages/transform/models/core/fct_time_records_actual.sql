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
    from {{ ref('dim_time_projects') }}
),

tags as (
    select
        tag_id,
        tag_name
    from {{ ref('stg_toggl_track__tags') }}
),

-- Dimension: Personal time categories + color mapping (includes sort_order)
-- Unnest color_hex_codes to enable join by project_color
dim_personal_colors as (
    select
        dp.name as personal_category,
        dp.coarse_category,
        dp.sort_order as personal_order,
        unnest(dp.color_hex_codes) as toggl_color_hex
    from {{ ref('dim_category_time_personal') }} dp
),

-- Dimension: Social time categories + client mapping (includes sort_order)
-- Unnest client_names to enable join by client_name
dim_social_clients as (
    select
        ds.name as social_category,
        ds.sort_order as social_order,
        unnest(ds.client_names) as client_name
    from {{ ref('dim_category_time_social') }} ds
),

-- Dimension: Coarse personal category for sort_order
dim_coarse as (
    select
        name as coarse_category,
        sort_order as coarse_order
    from {{ ref('dim_category_time_personal_coarse') }}
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
        -- Project info (from core.dim_time_projects)
        p.project_name,
        p.project_color,
        coalesce(p.project_order, 999) as project_order,
        -- Tags
        coalesce(tn.tag_names, array[]::text[]) as tag_names,
        -- Category mappings (via dimensions)
        coalesce(dsc.social_category, 'UNKNOWN') as social_category,
        coalesce(dpc.personal_category, 'Uncategorized') as personal_category,
        coalesce(dpc.coarse_category, 'Uncategorized') as coarse_personal_category,
        -- Sort orders (from dimensions)
        coalesce(dsc.social_order, 999) as social_order,
        coalesce(dpc.personal_order, 999) as personal_order,
        coalesce(dc.coarse_order, 999) as coarse_order
    from source_records sr
    left join projects p on p.project_id = sr.project_id
    left join tag_names_agg tn on tn.time_entry_id = sr.time_entry_id
    -- Personal category via color mapping (from ref.dim_category_time_personal)
    left join dim_personal_colors dpc on dpc.toggl_color_hex = p.project_color
    -- Social category via client mapping (from ref.dim_category_time_social)
    left join dim_social_clients dsc on dsc.client_name = p.client_name
    left join dim_coarse dc on dc.coarse_category = coalesce(dpc.coarse_category, 'Uncategorized')
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
