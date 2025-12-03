-- stg_toggl_track__time_entries.sql
-- =============================================================================
-- Toggl Track time entries staging model
-- Source: raw.toggl_track__time_entries (API v9)
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__time_entries') }}
),

staged as (
    select
        -- Primary key
        id,
        source_id::bigint as time_entry_id,

        -- Foreign keys
        (data->>'workspace_id')::bigint as workspace_id,
        (data->>'project_id')::bigint as project_id,
        (data->>'task_id')::bigint as task_id,
        (data->>'user_id')::bigint as user_id,

        -- Attributes
        data->>'description' as description,
        (data->>'billable')::boolean as is_billable,

        -- Tags (JSONB array to text array)
        case
            when data->'tags' is not null and jsonb_typeof(data->'tags') = 'array'
            then array(select jsonb_array_elements_text(data->'tags'))
            else array[]::text[]
        end as tags,

        -- Timestamps
        (data->>'start')::timestamptz as started_at,
        (data->>'stop')::timestamptz as stopped_at,

        -- Duration
        -- Toggl API: duration is in seconds, negative means running
        case
            when (data->>'duration')::bigint < 0 then null
            else (data->>'duration')::bigint
        end as duration_seconds,

        -- Running status
        (data->>'duration')::bigint < 0 as is_running,

        -- Audit
        (data->>'at')::timestamptz as updated_at,
        synced_at,

        -- Metadata
        api_version

    from source
)

select * from staged
