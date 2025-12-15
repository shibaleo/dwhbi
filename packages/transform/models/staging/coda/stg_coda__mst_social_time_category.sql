-- stg_coda__mst_social_time_category.sql
-- =============================================================================
-- Staging model for social time category master from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__mst_social_time_category') }}
),

parsed as (
    select
        source_id as row_id,
        data->>'name' as name,
        -- Column mappings from Coda:
        -- c-sEvySWZAmk: name (text)
        -- c-O1uHAp-nUm: name_ja (text)
        -- c-jPWGpzBvYU: description (text)
        -- c-bwYPuDnuo3: sort_order (number)
        (data->'values'->>'c-bwYPuDnuo3')::integer as sort_order,
        regexp_replace(data->'values'->>'c-O1uHAp-nUm', '^```|```$', '', 'g') as name_ja,
        regexp_replace(data->'values'->>'c-jPWGpzBvYU', '^```|```$', '', 'g') as description,
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
