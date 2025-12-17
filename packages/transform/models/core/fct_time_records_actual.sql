-- fct_time_records_actual.sql
-- =============================================================================
-- Core fact table for actual time records (from Toggl) - ENTRY LEVEL
-- Features:
--   - Original entries without day-splitting
--   - Running records: end_at = CURRENT_TIMESTAMP (NOT NULL guaranteed)
--   - Category mapping from project color and client
--   - Zero-duration entries filtered out
--   - Continuous time adjustment:
--     - Gap <= 5min: extend end_at to next entry's start_at
--     - Gap > 5min: insert 'Untracked' entry to fill the gap
--     - Overlap: trim end_at to next entry's start_at
--   - Output: UTC timestamptz for all timestamp columns
-- Use case: Entry-level analysis, sleep tracking, session duration analysis
-- =============================================================================

{% set gap_threshold_seconds = 300 %}  -- 5 minutes

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
),

-- =============================================================================
-- Continuous time adjustment: fill gaps and overlaps
-- - Gap <= threshold: extend end_at to next entry's start_at
-- - Gap > threshold: keep original end_at, generate Untracked entry separately
-- - Overlap (negative gap): trim end_at to next entry's start_at
-- =============================================================================
records_with_gaps as (
    select
        source_id,
        start_at,
        end_at,
        -- Get next entry's start_at (ordered by start_at)
        lead(start_at) over (order by start_at) as next_start_at,
        description,
        project_name,
        project_color,
        project_order,
        tag_names,
        social_category,
        personal_category,
        coarse_personal_category,
        social_order,
        personal_order,
        coarse_order
    from enriched_records
    where start_at < end_at  -- Filter out zero-duration entries
),

-- Calculate gap and determine adjustment strategy
records_with_strategy as (
    select
        *,
        -- Gap in seconds (positive = gap, negative = overlap)
        extract(epoch from (next_start_at - end_at))::integer as gap_seconds,
        -- Strategy: 'extend' for small gaps/overlaps, 'untracked' for large gaps
        case
            when next_start_at is null then 'keep'  -- Last entry
            when next_start_at <= end_at then 'trim'  -- Overlap
            when extract(epoch from (next_start_at - end_at)) <= {{ gap_threshold_seconds }} then 'extend'
            else 'untracked'
        end as adjustment_strategy
    from records_with_gaps
),

-- Adjusted original records
adjusted_records as (
    select
        source_id,
        start_at,
        case adjustment_strategy
            when 'keep' then end_at
            when 'trim' then next_start_at  -- Trim overlap
            when 'extend' then next_start_at  -- Extend to fill small gap
            when 'untracked' then end_at  -- Keep original, Untracked will fill gap
        end as end_at,
        description,
        project_name,
        project_color,
        project_order,
        tag_names,
        social_category,
        personal_category,
        coarse_personal_category,
        social_order,
        personal_order,
        coarse_order,
        'toggl_track' as source
    from records_with_strategy
),

-- Generate Untracked entries for large gaps
untracked_entries as (
    select
        'untracked_' || source_id as source_id,
        end_at as start_at,  -- Starts where previous entry ended
        next_start_at as end_at,  -- Ends where next entry starts
        null::text as description,
        null::text as project_name,
        null::text as project_color,
        999 as project_order,
        array[]::text[] as tag_names,
        'UNKNOWN' as social_category,
        'Untracked' as personal_category,
        'Untracked' as coarse_personal_category,
        999 as social_order,
        999 as personal_order,
        999 as coarse_order,
        'generated' as source
    from records_with_strategy
    where adjustment_strategy = 'untracked'
),

-- Combine adjusted records and untracked entries
all_records as (
    select * from adjusted_records
    union all
    select * from untracked_entries
)

-- =============================================================================
-- Final output
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
    source
from all_records
where start_at < end_at  -- Filter out zero or negative duration entries
