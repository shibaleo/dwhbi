-- stg_coda__time_toggl_projects.sql
-- =============================================================================
-- Staging model for Toggl projects master from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__mst_toggl_projects') }}
),

parsed as (
    select
        source_id as row_id,
        data->>'name' as name,
        -- Column mappings from Coda:
        -- c-nh7mmMbutT: name (text)
        -- c-nr8vyhxnFU: name_ja (text)
        -- c-BJ6gWKxqq9: description (text)
        -- c-g83dMFucN3: color (text)
        -- c-3iijRJICjQ: toggl_project_id (number)
        -- c-xHG4aEg2U0: sort_order (number)
        regexp_replace(data->'values'->>'c-nh7mmMbutT', '^```|```$', '', 'g') as project_name,
        regexp_replace(data->'values'->>'c-nr8vyhxnFU', '^```|```$', '', 'g') as name_ja,
        regexp_replace(data->'values'->>'c-BJ6gWKxqq9', '^```|```$', '', 'g') as description,
        regexp_replace(data->'values'->>'c-g83dMFucN3', '^```|```$', '', 'g') as color,
        (data->'values'->>'c-3iijRJICjQ')::integer as toggl_project_id,
        (data->'values'->>'c-xHG4aEg2U0')::integer as sort_order,
        synced_at
    from source
)

select
    row_id,
    name,
    project_name,
    name_ja,
    description,
    color,
    toggl_project_id,
    sort_order,
    synced_at
from parsed
order by sort_order
