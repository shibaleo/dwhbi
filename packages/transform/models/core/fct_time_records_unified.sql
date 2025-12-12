-- fct_time_records_unified.sql
-- =============================================================================
-- Unified view of actual and plan time records
-- Features:
--   - CURRENT_TIMESTAMP boundary between actual and plan
--   - In-progress records adjusted at boundary
--   - Uses split versions for day-boundary consistency
-- =============================================================================

{% set current_jst = "(current_timestamp at time zone 'Asia/Tokyo')::timestamp" %}

-- =============================================================================
-- 1. actual: Completed records (end_at <= now)
-- =============================================================================
select
    id,
    source_id,
    start_at,
    end_at,
    duration_seconds,
    description,
    social_category,
    personal_category,
    source,
    'actual' as record_type
from {{ ref('fct_time_records_actual_split') }}
where end_at <= {{ current_jst }}

union all

-- =============================================================================
-- 2. actual: In-progress records (start_at < now < end_at)
--    Adjust end_at to current timestamp
-- =============================================================================
select
    id,
    source_id,
    start_at,
    {{ current_jst }} as end_at,
    extract(epoch from {{ current_jst }} - start_at)::integer as duration_seconds,
    description,
    social_category,
    personal_category,
    source,
    'actual' as record_type
from {{ ref('fct_time_records_actual_split') }}
where start_at < {{ current_jst }}
  and end_at > {{ current_jst }}

union all

-- =============================================================================
-- 3. plan: Future records (start_at >= now)
-- =============================================================================
select
    id,
    source_id,
    start_at,
    end_at,
    duration_seconds,
    description,
    social_category,
    personal_category,
    source,
    'plan' as record_type
from {{ ref('fct_time_records_plan') }}
where start_at >= {{ current_jst }}

union all

-- =============================================================================
-- 4. plan: In-progress records (start_at < now < end_at)
--    Adjust start_at to current timestamp
-- =============================================================================
select
    id,
    source_id,
    {{ current_jst }} as start_at,
    end_at,
    extract(epoch from end_at - {{ current_jst }})::integer as duration_seconds,
    description,
    social_category,
    personal_category,
    source,
    'plan' as record_type
from {{ ref('fct_time_records_plan') }}
where start_at < {{ current_jst }}
  and end_at > {{ current_jst }}
