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
        -- Column mappings from Coda:
        -- c-NpJV7ZrNzG: name (text)
        -- c-_Vs5TQWJBP: sort_order (number)
        -- c-hGwytcONV9: name_ja (text)
        -- c-mfoE0PLZ3O: description (text)
        -- c-lR-bdMOECK: mst_coarse_personal_time_category (lookup)
        (data->'values'->>'c-_Vs5TQWJBP')::integer as sort_order,
        regexp_replace(data->'values'->>'c-hGwytcONV9', '^```|```$', '', 'g') as name_ja,
        regexp_replace(data->'values'->>'c-mfoE0PLZ3O', '^```|```$', '', 'g') as description,
        -- Extract name from row reference object for coarse category
        case
            when jsonb_typeof(data->'values'->'c-lR-bdMOECK') = 'object'
            then data->'values'->'c-lR-bdMOECK'->>'name'
            else null
        end as coarse_category,
        synced_at
    from source
)

select
    row_id,
    name,
    name_ja,
    description,
    coarse_category,
    sort_order,
    synced_at
from parsed
order by sort_order
