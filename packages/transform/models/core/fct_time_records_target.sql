-- fct_time_records_target.sql
-- =============================================================================
-- Core fact table for target time records (from Google Calendar) - ENTRY LEVEL
-- Features:
--   - Original entries without day-splitting
--   - Project mapping via summary -> dim_time_projects.project_name
--   - Category mapping from project color (via dim_category_time_personal)
--   - Social category mapping from client (via dim_category_time_social)
--   - Output: UTC timestamptz for all timestamp columns (aligned with fct_time_records_actual)
-- Use case: Entry-level analysis, session duration analysis
-- =============================================================================

with source_records as (
    select * from {{ ref('stg_google_calendar__events') }}
    where status != 'cancelled'  -- Exclude cancelled events
),

-- Dimension: Time projects (for project_name -> project_color, client_name, sort_order)
projects as (
    select
        project_name,
        project_color,
        client_name,
        sort_order as project_order
    from {{ ref('dim_time_projects') }}
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
        -- Project info (from dim_time_projects via summary)
        p.project_name,
        p.project_color,
        coalesce(p.project_order, 999) as project_order,
        -- Category mappings (via dimensions - same as fct_time_records_actual)
        coalesce(dsc.social_category, 'UNKNOWN') as social_category,
        coalesce(dpc.personal_category, 'Uncategorized') as personal_category,
        coalesce(dpc.coarse_category, 'Uncategorized') as coarse_personal_category,
        -- Sort orders (from dimensions)
        coalesce(dsc.social_order, 999) as social_order,
        coalesce(dpc.personal_order, 999) as personal_order,
        coalesce(dc.coarse_order, 999) as coarse_order
    from source_records sr
    -- Join project fact by summary = project_name
    left join projects p on p.project_name = sr.summary
    -- Personal category via color mapping (from dim_category_time_personal)
    left join dim_personal_colors dpc on dpc.toggl_color_hex = p.project_color
    -- Social category via client mapping (from dim_category_time_social)
    left join dim_social_clients dsc on dsc.client_name = p.client_name
    -- Join coarse category dimension for sort_order
    left join dim_coarse dc on dc.coarse_category = coalesce(dpc.coarse_category, 'Uncategorized')
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
    -- Project columns (from dim_time_projects via summary)
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
