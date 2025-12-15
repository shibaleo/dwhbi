-- fct_time_records_target.sql
-- =============================================================================
-- Core fact table for target time records (from Google Calendar) - ENTRY LEVEL
-- Features:
--   - Original entries without day-splitting
--   - Project mapping via summary -> mst_time_projects.project_name
--   - Category mapping from project color (via mst_personal_time_category)
--   - Social category mapping from client (via mst_social_time_category)
--   - Output: UTC timestamptz for all timestamp columns (aligned with fct_time_records_actual)
-- Use case: Entry-level analysis, session duration analysis
-- =============================================================================

with source_records as (
    select * from {{ ref('stg_google_calendar__events') }}
    where status != 'cancelled'  -- Exclude cancelled events
),

-- Core master: Time projects (for project_name -> project_color, client_name, sort_order)
projects as (
    select
        project_name,
        project_color,
        client_name,
        sort_order as project_order
    from {{ ref('mst_time_projects') }}
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
-- Enrich records with project info and categories
-- =============================================================================
enriched_records as (
    select
        sr.event_id::text as source_id,
        -- Keep original UTC timestamptz (aligned with fct_time_records_actual)
        sr.start_at,
        sr.end_at,
        -- Map summary to description
        sr.summary as description,
        -- Project info (from mst_time_projects via summary)
        p.project_name,
        p.project_color,
        coalesce(p.project_order, 999) as project_order,
        -- Category mappings (via core masters - same as fct_time_records_actual)
        coalesce(msc.social_category, 'UNKNOWN') as social_category,
        coalesce(mpc.personal_category, 'Uncategorized') as personal_category,
        coalesce(mpc.coarse_category, 'Uncategorized') as coarse_personal_category,
        -- Sort orders (from core masters)
        coalesce(msc.social_order, 999) as social_order,
        coalesce(mpc.personal_order, 999) as personal_order,
        coalesce(mc.coarse_order, 999) as coarse_order
    from source_records sr
    -- Join project master by summary = project_name
    left join projects p on p.project_name = sr.summary
    -- Personal category via color mapping (from mst_personal_time_category)
    left join mst_personal_colors mpc on mpc.toggl_color_hex = p.project_color
    -- Social category via client mapping (from mst_social_time_category)
    left join mst_social_clients msc on msc.client_name = p.client_name
    -- Join coarse category master for sort_order
    left join mst_coarse mc on mc.coarse_category = coalesce(mpc.coarse_category, 'Uncategorized')
)

-- =============================================================================
-- Final output (aligned with fct_time_records_actual)
-- =============================================================================
select
    source_id as id,
    source_id,
    start_at,
    end_at,
    extract(epoch from (end_at - start_at))::integer as duration_seconds,
    description,
    -- Project columns (from mst_time_projects via summary)
    project_name,
    project_color,
    array[]::text[] as tag_names,  -- Empty array (no tags for calendar events)
    -- Category columns
    social_category,
    personal_category,
    coarse_personal_category,
    -- Sort order columns
    social_order,
    personal_order,
    coarse_order,
    project_order,
    -- Source
    'google_calendar' as source
from enriched_records
where start_at < end_at  -- Filter out zero-duration entries
