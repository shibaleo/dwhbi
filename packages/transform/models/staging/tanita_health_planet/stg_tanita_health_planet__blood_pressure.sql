-- stg_tanita_health_planet__blood_pressure.sql
-- =============================================================================
-- Tanita Health Planet blood pressure staging model
-- Source: raw.tanita_health_planet__blood_pressure (Health Planet API v1)
--
-- Health Planet Sphygmomanometer API data:
-- - Tag 622E: 最高血圧 (systolic) in mmHg
-- - Tag 622F: 最低血圧 (diastolic) in mmHg
-- - Tag 6230: 脈拍 (pulse) in bpm
--
-- Note: source_id (ISO8601 UTC) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_tanita_health_planet', 'tanita_health_planet__blood_pressure') }}
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

        -- Blood pressure data
        (data->>'systolic')::integer as systolic,
        (data->>'diastolic')::integer as diastolic,
        (data->>'pulse')::integer as pulse,

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
