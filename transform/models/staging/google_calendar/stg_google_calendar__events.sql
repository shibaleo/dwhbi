-- stg_google_calendar__events.sql
-- =============================================================================
-- Google Calendar events staging model
-- Source: raw.google_calendar__events (API v3)
--
-- Google Calendar Event fields reference:
-- https://developers.google.com/calendar/api/v3/reference/events
--
-- Note: event_id でユニーク化（同じイベントが複数回同期された場合は最新を採用）
-- =============================================================================

with source as (
    select * from {{ source('raw_google_calendar', 'google_calendar__events') }}
),

-- event_id ごとに最新のレコードを取得
deduplicated as (
    select
        *,
        row_number() over (
            partition by data->>'id'
            order by synced_at desc
        ) as rn
    from source
),

staged as (
    select
        -- Primary key (raw層のUUID)
        id,

        -- Event identifiers
        source_id,
        data->>'id' as event_id,
        data->>'iCalUID' as ical_uid,
        data->>'recurringEventId' as recurring_event_id,

        -- Calendar reference (added by sync process as _calendar_id)
        data->>'_calendar_id' as calendar_id,

        -- Event type and status
        data->>'kind' as kind,
        data->>'status' as status,
        data->>'eventType' as event_type,
        data->>'visibility' as visibility,
        data->>'transparency' as transparency,

        -- Basic info
        data->>'summary' as summary,
        data->>'description' as description,
        data->>'location' as location,
        data->>'htmlLink' as html_link,
        data->>'hangoutLink' as hangout_link,

        -- Time fields - Start
        -- Note: All-day events use 'date', timed events use 'dateTime'
        coalesce(
            (data->'start'->>'dateTime')::timestamptz,
            (data->'start'->>'date')::date::timestamptz
        ) as start_at,
        data->'start'->>'dateTime' as start_datetime,
        data->'start'->>'date' as start_date,
        data->'start'->>'timeZone' as start_timezone,
        case
            when data->'start'->>'date' is not null then true
            else false
        end as is_all_day,

        -- Time fields - End
        coalesce(
            (data->'end'->>'dateTime')::timestamptz,
            (data->'end'->>'date')::date::timestamptz
        ) as end_at,
        data->'end'->>'dateTime' as end_datetime,
        data->'end'->>'date' as end_date,
        data->'end'->>'timeZone' as end_timezone,

        -- Original start time (for recurring events)
        coalesce(
            (data->'originalStartTime'->>'dateTime')::timestamptz,
            (data->'originalStartTime'->>'date')::date::timestamptz
        ) as original_start_at,

        -- Creator and Organizer
        data->'creator'->>'email' as creator_email,
        data->'creator'->>'displayName' as creator_display_name,
        (data->'creator'->>'self')::boolean as is_creator_self,
        data->'organizer'->>'email' as organizer_email,
        data->'organizer'->>'displayName' as organizer_display_name,
        (data->'organizer'->>'self')::boolean as is_organizer_self,

        -- Recurrence
        data->>'recurrence' as recurrence,

        -- Colors
        data->>'colorId' as color_id,

        -- Attendees count
        jsonb_array_length(coalesce(data->'attendees', '[]'::jsonb)) as attendees_count,

        -- Reminders
        (data->'reminders'->>'useDefault')::boolean as reminders_use_default,

        -- Conference data
        data->'conferenceData'->>'conferenceId' as conference_id,
        data->'conferenceData'->'conferenceSolution'->>'name' as conference_solution_name,
        data->'conferenceData'->'entryPoints'->0->>'uri' as conference_entry_point_uri,

        -- Attachments count
        jsonb_array_length(coalesce(data->'attachments', '[]'::jsonb)) as attachments_count,

        -- Flags
        (data->>'guestsCanModify')::boolean as guests_can_modify,
        (data->>'guestsCanInviteOthers')::boolean as guests_can_invite_others,
        (data->>'guestsCanSeeOtherGuests')::boolean as guests_can_see_other_guests,
        (data->>'privateCopy')::boolean as is_private_copy,
        (data->>'locked')::boolean as is_locked,

        -- Sequence (version number for changes)
        (data->>'sequence')::integer as sequence,

        -- Timestamps
        (data->>'created')::timestamptz as created_at,
        (data->>'updated')::timestamptz as updated_at,

        -- Audit
        synced_at,
        api_version

    from deduplicated
    where rn = 1
)

select * from staged
