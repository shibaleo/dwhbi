-- stg_toggl_track__users.sql
-- =============================================================================
-- Toggl Track users staging model
-- Source: raw.toggl_track__users (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__users') }}
),

staged as (
    select
        -- Primary key
        id,
        source_id::bigint as user_id,

        -- Attributes
        data->>'email' as email,
        data->>'fullname' as full_name,
        data->>'timezone' as timezone,
        (data->>'admin')::boolean as is_admin,
        (data->>'active')::boolean as is_active,

        -- Timestamps
        (data->>'at')::timestamptz as updated_at,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
