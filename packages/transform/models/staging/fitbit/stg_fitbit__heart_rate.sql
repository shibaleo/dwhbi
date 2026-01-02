-- stg_fitbit__heart_rate.sql
-- =============================================================================
-- Fitbit heart rate staging model
-- Source: raw.fitbit__heart_rate (Fitbit Web API v1)
-- =============================================================================

with source as (
    select * from {{ source('raw_fitbit', 'fitbit__heart_rate') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- Resting heart rate
        (data->>'resting_heart_rate')::integer as resting_heart_rate,

        -- Heart rate zones (JSONB array)
        data->'heart_rate_zones' as heart_rate_zones,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
