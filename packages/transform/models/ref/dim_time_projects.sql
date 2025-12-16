-- dim_time_projects.sql
-- =============================================================================
-- Dimension: Toggl projects with Coda metadata
-- Integrates:
--   - stg_toggl_track__projects: Toggl API project data (source of truth)
--   - stg_toggl_track__clients: Toggl API client data (for client_name)
--   - stg_coda__time_toggl_projects: Coda supplementary metadata (sort_order, name_ja)
-- =============================================================================

with toggl_projects as (
    select
        project_id,
        project_name,
        color as project_color,
        client_id,
        is_active,
        is_private,
        is_billable,
        created_at,
        updated_at
    from {{ ref('stg_toggl_track__projects') }}
),

toggl_clients as (
    select
        client_id,
        client_name
    from {{ ref('stg_toggl_track__clients') }}
),

coda_metadata as (
    select
        toggl_project_id,
        name_ja,
        description,
        sort_order
    from {{ ref('stg_coda__time_toggl_projects') }}
)

select
    tp.project_id,
    tp.project_name,
    tp.project_color,
    tp.client_id,
    tc.client_name,
    cm.name_ja,
    cm.description,
    coalesce(cm.sort_order, 999) as sort_order,
    tp.is_active,
    tp.is_private,
    tp.is_billable,
    tp.created_at,
    tp.updated_at
from toggl_projects tp
left join toggl_clients tc on tc.client_id = tp.client_id
left join coda_metadata cm on cm.toggl_project_id = tp.project_id
