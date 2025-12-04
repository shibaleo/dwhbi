-- stg_google_calendar__colors.sql
-- =============================================================================
-- Google Calendar colors staging model
-- Source: raw.google_calendar__colors (API v3)
--
-- Colors API returns event and calendar color palettes.
-- https://developers.google.com/calendar/api/v3/reference/colors
-- =============================================================================

with source as (
    select * from {{ source('raw_google_calendar', 'google_calendar__colors') }}
),

-- Unnest the colors object to individual rows
colors_unnested as (
    select
        id,
        source_id as color_kind,
        key as color_id,
        value->>'background' as background_color,
        value->>'foreground' as foreground_color,
        synced_at,
        api_version
    from source,
    lateral jsonb_each(data->'colors') as colors(key, value)
),

staged as (
    select
        -- Primary key (composite)
        id,
        color_kind,
        color_id,

        -- Color values
        background_color,
        foreground_color,

        -- Audit
        synced_at,
        api_version

    from colors_unnested
)

select * from staged
