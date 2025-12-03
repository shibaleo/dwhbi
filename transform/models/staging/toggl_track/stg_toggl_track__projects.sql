-- stg_toggl_track__projects.sql
-- =============================================================================
-- Toggl Track projects staging model
-- Source: raw.toggl_track__projects (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__projects') }}
),

staged as (
    select
        -- Primary key
        id,
        source_id::bigint as project_id,

        -- Foreign keys
        (data->>'workspace_id')::bigint as workspace_id,
        (data->>'client_id')::bigint as client_id,

        -- Attributes
        data->>'name' as project_name,
        data->>'color' as color,
        (data->>'is_private')::boolean as is_private,
        (data->>'active')::boolean as is_active,
        (data->>'billable')::boolean as is_billable,

        -- Timestamps
        (data->>'created_at')::timestamptz as created_at,
        (data->>'at')::timestamptz as updated_at,
        (data->>'server_deleted_at')::timestamptz as archived_at,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
