-- stg_coda__mst_google_calendar_colors.sql
-- =============================================================================
-- Staging model for Google Calendar color master from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__mst_google_calendar_colors') }}
),

parsed as (
    select
        source_id as row_id,
        -- Column mappings from Coda:
        -- c-rYvwzZfZoh: color_name (e.g., "Tomato", "Basil")
        -- c-9wdjufUu6t: color_hex (e.g., "#d50000")

        -- Remove markdown code block markers from text values
        regexp_replace(data->'values'->>'c-rYvwzZfZoh', '^```|```$', '', 'g') as color_name,
        regexp_replace(data->'values'->>'c-9wdjufUu6t', '^```|```$', '', 'g') as color_hex,

        synced_at
    from source
)

select
    row_id,
    color_name,
    color_hex,
    synced_at
from parsed
where color_name is not null
