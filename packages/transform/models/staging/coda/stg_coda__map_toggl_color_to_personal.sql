-- stg_coda__map_toggl_color_to_personal.sql
-- =============================================================================
-- Staging model for Toggl color to personal time category mapping from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__map_toggl_color_to_personal') }}
),

parsed as (
    select
        source_id as row_id,
        -- Column mappings from Coda:
        -- c-mVB9a05MMr: toggl_color_hex
        -- c-Z4DQnZWWBX: toggl_color_name
        -- c-LxDtYCIJVU: personal_category (row reference or empty string)
        regexp_replace(data->'values'->>'c-mVB9a05MMr', '^```|```$', '', 'g') as toggl_color_hex,
        regexp_replace(data->'values'->>'c-Z4DQnZWWBX', '^```|```$', '', 'g') as toggl_color_name,
        -- Extract name from row reference object, or null if empty/not set
        case
            when jsonb_typeof(data->'values'->'c-LxDtYCIJVU') = 'object'
            then data->'values'->'c-LxDtYCIJVU'->>'name'
            else null
        end as time_category_personal,
        synced_at
    from source
)

select
    row_id,
    toggl_color_hex,
    toggl_color_name,
    time_category_personal,
    synced_at
from parsed
