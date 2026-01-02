-- stg_tanita_health_planet__body_composition.sql
-- =============================================================================
-- Tanita Health Planet body composition staging model
-- Source: raw.tanita_health_planet__body_composition (Health Planet API v1)
--
-- Health Planet InnerScan API data:
-- - Tag 6021: 体重 (weight) in kg
-- - Tag 6022: 体脂肪率 (body fat percent) in %
--
-- Note: source_id (ISO8601 UTC) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_tanita_health_planet', 'tanita_health_planet__body_composition') }}
),

staged as (
    select
        -- Primary key (raw層のUUID)
        id,

        -- Source identifier
        source_id,

        -- Measurement datetime
        -- source_id is ISO8601 UTC format, convert to timestamptz
        source_id::timestamptz as measured_at,

        -- JST datetime (for display, as timestamp without timezone)
        ((data->>'_measured_at_jst')::timestamptz at time zone 'Asia/Tokyo')::timestamp as measured_at_jst,

        -- Body composition data
        (data->>'weight')::numeric as weight,
        (data->>'body_fat_percent')::numeric as body_fat_percent,

        -- Device info
        data->>'model' as model,

        -- Original API response fields
        data->>'date' as raw_date,
        data->>'tag' as raw_tag,
        data->>'keydata' as raw_keydata,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
