-- mst_toggl_projects.sql
-- =============================================================================
-- Reference layer: Toggl projects master from Coda
-- Source-independent view for DWH-wide usage
-- =============================================================================

select
    row_id,
    name,
    project_name,
    name_ja,
    description,
    color,
    toggl_project_id,
    sort_order,
    synced_at
from {{ ref('stg_coda__mst_toggl_projects') }}
