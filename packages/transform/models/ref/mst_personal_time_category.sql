-- mst_personal_time_category.sql
-- =============================================================================
-- Reference layer: Personal time category master
-- Source-independent view for DWH-wide usage
-- =============================================================================

select
    row_id,
    name,
    name_ja,
    description,
    sort_order,
    synced_at
from {{ ref('stg_coda__mst_personal_time_category') }}
