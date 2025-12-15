-- stg_coda__map_toggl_client_to_social.sql
-- =============================================================================
-- Staging model for Toggl client to social time category mapping from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__map_toggl_client_to_social') }}
),

parsed as (
    select
        source_id as row_id,
        -- Column mappings from Coda:
        -- c-WMEKu7txaj: toggl_client_name (text)
        -- c-VtTqPV1rdK: social_time_category_name (lookup/row reference)
        regexp_replace(data->'values'->>'c-WMEKu7txaj', '^```|```$', '', 'g') as toggl_client_name,
        -- Extract name from row reference object
        case
            when jsonb_typeof(data->'values'->'c-VtTqPV1rdK') = 'object'
            then data->'values'->'c-VtTqPV1rdK'->>'name'
            else null
        end as time_category_social,
        synced_at
    from source
)

select
    row_id,
    toggl_client_name,
    time_category_social,
    synced_at
from parsed
