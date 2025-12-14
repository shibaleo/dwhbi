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
        -- c-VtTqPV1rdK: toggl_client_name
        -- c-WMEKu7txaj: time_category_social
        regexp_replace(data->'values'->>'c-VtTqPV1rdK', '^```|```$', '', 'g') as toggl_client_name,
        regexp_replace(data->'values'->>'c-WMEKu7txaj', '^```|```$', '', 'g') as time_category_social,
        synced_at
    from source
)

select
    row_id,
    toggl_client_name,
    time_category_social,
    synced_at
from parsed
