-- daily_category_hours_paired.sql
-- =============================================================================
-- Analysis: Paired actual-target daily category hours
-- Joins actual data with target templates based on day_type (weekday/holiday)
-- Used for inverse optimal transport cost matrix estimation
-- =============================================================================

with actual as (
    select * from {{ ref('daily_category_hours_actual') }}
),

target_template as (
    select * from {{ ref('daily_category_hours_target_template') }}
)

select
    a.date,
    a.day_of_week,
    a.day_type,
    -- Actual hours
    a.vitals_hours as actual_vitals,
    a.sleep_hours as actual_sleep,
    a.exercise_hours as actual_exercise,
    a.overhead_hours as actual_overhead,
    a.work_hours as actual_work,
    a.education_hours as actual_education,
    a.creative_hours as actual_creative,
    a.social_hours as actual_social,
    a.meta_hours as actual_meta,
    a.pleasure_hours as actual_pleasure,
    a.total_hours as actual_total,
    -- Target hours (from template based on day_type)
    t.vitals_hours as target_vitals,
    t.sleep_hours as target_sleep,
    t.exercise_hours as target_exercise,
    t.overhead_hours as target_overhead,
    t.work_hours as target_work,
    t.education_hours as target_education,
    t.creative_hours as target_creative,
    t.social_hours as target_social,
    t.meta_hours as target_meta,
    t.pleasure_hours as target_pleasure,
    t.total_hours as target_total
from actual a
join target_template t on a.day_type = t.day_type
order by a.date
