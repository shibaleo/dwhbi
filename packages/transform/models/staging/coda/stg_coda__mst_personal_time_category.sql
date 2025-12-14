-- stg_coda__mst_personal_time_category.sql
-- =============================================================================
-- Staging model for personal time category master from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__mst_personal_time_category') }}
),

parsed as (
    select
        source_id as row_id,
        data->>'name' as name,
        (data->>'index')::integer as sort_order,
        -- Column mappings from Coda:
        -- c-NpJV7ZrNzG: name (redundant with data.name)
        -- c-_Vs5TQWJBP: sort_order
        -- c-hGwytcONV9: name_ja
        -- c-mfoE0PLZ3O: description
        regexp_replace(data->'values'->>'c-hGwytcONV9', '^```|```$', '', 'g') as name_ja,
        regexp_replace(data->'values'->>'c-mfoE0PLZ3O', '^```|```$', '', 'g') as description,
        synced_at
    from source
)

select
    row_id,
    name,
    name_ja,
    description,
    sort_order,
    synced_at
from parsed
order by sort_order
