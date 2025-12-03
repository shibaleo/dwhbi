-- stg_toggl_track__time_entries_report.sql
-- =============================================================================
-- Toggl Track time entries from Reports API v3 staging model
-- Source: raw.toggl_track__time_entries_report (Reports API v3)
--
-- Note: Reports API provides additional fields like billable_amount
-- =============================================================================

with source as (
    select * from {{ source('raw_toggl_track', 'toggl_track__time_entries_report') }}
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
            when data->'tag_ids' is not null and jsonb_typeof(data->'tag_ids') = 'array'
            then array(select jsonb_array_elements_text(data->'tag_ids'))
            else array[]::text[]
        end as tag_ids,

        -- Timestamps
        (data->>'start')::timestamptz as started_at,
        (data->>'end')::timestamptz as stopped_at,

        -- Duration (Reports API uses seconds)
        (data->>'seconds')::bigint as duration_seconds,

        -- Billable information (Reports API only)
        (data->>'billable_amount_in_cents')::numeric / 100 as billable_amount,
        data->>'currency' as currency,

        -- Audit
        (data->>'at')::timestamptz as updated_at,
        synced_at,
        api_version

    from source
)

select * from staged
