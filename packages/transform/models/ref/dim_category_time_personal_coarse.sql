-- dim_category_time_personal_coarse.sql
-- =============================================================================
-- Dimension: Coarse personal time category
-- Source-independent view for DWH-wide usage
-- =============================================================================

select
    row_id,
    name,
    sort_order,
    synced_at
from {{ ref('stg_coda__time_category_personal_coarse') }}
