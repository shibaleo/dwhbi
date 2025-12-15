-- fct_time_records_actual_split.sql
-- =============================================================================
-- Core fact table for actual time records - DAY SPLIT VERSION
-- Features:
--   - References fct_time_records_actual (single source of truth)
--   - JST 00:00:00 boundary day-splitting via recursive CTE
--   - Adjusts start_at and end_at for each split segment
--   - Output: UTC timestamptz for all timestamp columns
-- Use case: Daily aggregation, day-boundary analysis
-- =============================================================================

with recursive source_records as (
    -- Get all records from fct_time_records_actual
    -- Convert to JST for day-boundary detection
    select
        source_id,
        start_at,
        end_at,
        (start_at at time zone 'Asia/Tokyo')::timestamp as start_jst,
        (end_at at time zone 'Asia/Tokyo')::timestamp as end_jst,
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
    from {{ ref('fct_time_records_actual') }}
),

-- =============================================================================
-- Day-split using recursive CTE (JST 00:00:00 boundary)
-- =============================================================================
split_records as (
    -- Base case: first segment of each record
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
        personal_category,
        coarse_personal_category,
        social_order,
        personal_order,
        coarse_order,
        project_order,
        source
    from source_records

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
        personal_category,
        coarse_personal_category,
        social_order,
        personal_order,
        coarse_order,
        project_order,
        source
    from split_records
    where start_jst::date < end_jst::date  -- Still spans multiple days
)

-- =============================================================================
-- Final output with adjusted timestamps and duration
-- Convert JST back to UTC timestamptz for output
-- =============================================================================
select
    source_id || '_' || split_index as id,
    source_id,
    -- Adjusted start_at: original start or midnight JST
    (start_jst at time zone 'Asia/Tokyo')::timestamptz as start_at,
    -- Adjusted end_at: next midnight JST or original end
    (least(end_jst, (start_jst::date + interval '1 day')::timestamp) at time zone 'Asia/Tokyo')::timestamptz as end_at,
    -- Duration for this segment
    extract(epoch from
        least(end_jst, (start_jst::date + interval '1 day')::timestamp) - start_jst
    )::integer as duration_seconds,
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
from split_records
where start_jst < least(end_jst, (start_jst::date + interval '1 day')::timestamp)
