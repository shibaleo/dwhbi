-- stg_google_calendar__calendars.sql
-- =============================================================================
-- Google Calendar metadata staging model
-- Source: raw.google_calendar__calendars (API v3)
--
-- Google Calendar Calendars fields reference:
-- https://developers.google.com/calendar/api/v3/reference/calendars
-- =============================================================================

with source as (
    select * from {{ source('raw_google_calendar', 'google_calendar__calendars') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Calendar identifiers
        source_id as calendar_id,
        data->>'kind' as kind,
        data->>'etag' as etag,

        -- Basic info
        data->>'summary' as summary,
        data->>'description' as description,
        data->>'location' as location,
        data->>'timeZone' as timezone,

        -- Conference properties
        data->'conferenceProperties'->'allowedConferenceSolutionTypes' as allowed_conference_types,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
