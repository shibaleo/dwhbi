-- stg_toggl_track__groups.sql
-- =============================================================================
-- Toggl Track workspace groups staging model
-- Source: raw.toggl_track__groups (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__groups') }}
),

staged as (
    select
        -- Primary key
        id,
        source_id::bigint as group_id,

        -- Foreign keys
        (data->>'workspace_id')::bigint as workspace_id,

        -- Attributes
        data->>'name' as group_name,

        -- Timestamps
        (data->>'at')::timestamptz as updated_at,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
