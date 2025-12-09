-- stg_toggl_track__clients.sql
-- =============================================================================
-- Toggl Track clients staging model
-- Source: raw.toggl_track__clients (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__clients') }}
),

staged as (
    select
        -- Primary key
        id,
        source_id::bigint as client_id,

        -- Foreign keys
        (data->>'wid')::bigint as workspace_id,

        -- Attributes
        data->>'name' as client_name,
        coalesce((data->>'archived')::boolean, false) as is_archived,

        -- Timestamps
        (data->>'at')::timestamptz as created_at,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
