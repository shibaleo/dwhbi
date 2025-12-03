-- stg_toggl_track__me.sql
-- =============================================================================
-- Toggl Track current user profile staging model
-- Source: raw.toggl_track__me (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__me') }}
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
        (data->>'default_workspace_id')::bigint as default_workspace_id,
        data->>'image_url' as image_url,
        (data->>'beginning_of_week')::int as beginning_of_week,
        data->>'country_id' as country_id,

        -- Timestamps
        (data->>'created_at')::timestamptz as created_at,
        (data->>'at')::timestamptz as updated_at,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
