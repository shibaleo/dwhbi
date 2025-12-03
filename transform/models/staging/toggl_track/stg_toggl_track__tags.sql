-- stg_toggl_track__tags.sql
-- =============================================================================
-- Toggl Track tags staging model
-- Source: raw.toggl_track__tags (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__tags') }}
),

staged as (
    select
        -- Primary key
        id,
        source_id::bigint as tag_id,

        -- Foreign keys
        (data->>'workspace_id')::bigint as workspace_id,

        -- Attributes
        data->>'name' as tag_name,

        -- Timestamps
        (data->>'at')::timestamptz as created_at,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
