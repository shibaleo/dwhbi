-- map_toggl_color_to_personal.sql
-- =============================================================================
-- Reference layer: Toggl color to personal time category mapping
-- Source-independent view for DWH-wide usage
-- =============================================================================

select
    row_id,
    toggl_color_hex,
    toggl_color_name,
    time_category_personal,
    synced_at
from {{ ref('stg_coda__map_toggl_color_to_personal') }}
