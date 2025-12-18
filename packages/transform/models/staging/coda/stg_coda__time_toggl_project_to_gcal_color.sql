-- stg_coda__time_toggl_project_to_gcal_color.sql
-- =============================================================================
-- Staging model for Toggl project to Google Calendar color mapping from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__map_toggl_project_to_gcal_color') }}
),

parsed as (
    select
        source_id as row_id,
        -- Column mappings from Coda:
        -- c-8ypKcpyu7v: toggl_project (row reference to mst_toggl_projects)
        -- c-IBOW-WzfnK: gcal_color (row reference to mst_google_calendar_colors)

        -- Extract toggl project info from row reference
        case
            when jsonb_typeof(data->'values'->'c-8ypKcpyu7v') = 'object'
            then data->'values'->'c-8ypKcpyu7v'->>'name'
            else null
        end as toggl_project_name,
        case
            when jsonb_typeof(data->'values'->'c-8ypKcpyu7v') = 'object'
            then data->'values'->'c-8ypKcpyu7v'->>'rowId'
            else null
        end as toggl_project_row_id,

        -- Extract gcal color info from row reference
        case
            when jsonb_typeof(data->'values'->'c-IBOW-WzfnK') = 'object'
            then data->'values'->'c-IBOW-WzfnK'->>'name'
            else null
        end as gcal_color_name,
        case
            when jsonb_typeof(data->'values'->'c-IBOW-WzfnK') = 'object'
            then data->'values'->'c-IBOW-WzfnK'->>'rowId'
            else null
        end as gcal_color_row_id,

        synced_at
    from source
)

select
    row_id,
    toggl_project_name,
    toggl_project_row_id,
    gcal_color_name,
    gcal_color_row_id,
    synced_at
from parsed
where toggl_project_name is not null
