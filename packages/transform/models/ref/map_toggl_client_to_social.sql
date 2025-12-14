-- map_toggl_client_to_social.sql
-- =============================================================================
-- Reference layer: Toggl client to social time category mapping
-- Source-independent view for DWH-wide usage
-- =============================================================================

select
    row_id,
    toggl_client_name,
    time_category_social,
    synced_at
from {{ ref('stg_coda__map_toggl_client_to_social') }}
