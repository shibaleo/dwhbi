-- stg_coda__mst_coarse_personal_time_category.sql
-- =============================================================================
-- Staging model for coarse personal time category master from Coda
-- =============================================================================

with source as (
    select * from {{ source('raw_coda', 'coda__mst_coarse_personal_time_category') }}
),

parsed as (
    select
        source_id as row_id,
        data->>'name' as name,
        -- Column mappings from Coda:
        -- c-tgkNehAfl6: name (text) - redundant with data.name
        -- c-z6vPiX9B0V: sort_order (number)
        (data->'values'->>'c-z6vPiX9B0V')::integer as sort_order,
        synced_at
    from source
)

select
    row_id,
    name,
    sort_order,
    synced_at
from parsed
order by sort_order
