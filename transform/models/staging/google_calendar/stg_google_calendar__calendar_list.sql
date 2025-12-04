-- stg_google_calendar__calendar_list.sql
-- =============================================================================
-- Google Calendar list entries staging model
-- Source: raw.google_calendar__calendar_list (API v3)
--
-- CalendarList represents the user's calendar subscriptions.
-- https://developers.google.com/calendar/api/v3/reference/calendarList
-- =============================================================================

with source as (
    select * from {{ source('raw_google_calendar', 'google_calendar__calendar_list') }}
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
        data->>'summaryOverride' as summary_override,
        data->>'description' as description,
        data->>'location' as location,
        data->>'timeZone' as timezone,

        -- Display settings
        data->>'colorId' as color_id,
        data->>'backgroundColor' as background_color,
        data->>'foregroundColor' as foreground_color,

        -- Access role
        data->>'accessRole' as access_role,

        -- Flags
        (data->>'selected')::boolean as is_selected,
        (data->>'hidden')::boolean as is_hidden,
        (data->>'deleted')::boolean as is_deleted,
        (data->>'primary')::boolean as is_primary,

        -- Notification settings
        data->'notificationSettings' as notification_settings,
        data->'defaultReminders' as default_reminders,

        -- Conference properties
        data->'conferenceProperties'->'allowedConferenceSolutionTypes' as allowed_conference_types,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
