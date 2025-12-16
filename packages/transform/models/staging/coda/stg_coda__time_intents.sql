-- stg_coda__time_intents.sql
-- =============================================================================
-- Time Intent テーブルの staging 層モデル
-- Coda の Table (grid-Wu3URkM3rF) から Intent データを抽出
-- =============================================================================

-- Column ID mapping (from Coda API):
-- c-UhKVwZKQUh: Description
-- c-xwuY2PtROo: Personal Category (relation)
-- c-qJhTJfo3_d: Project (relation)
-- c-MVk62_pLen: Hours
-- c-DfYJ5h1IZF: Unit (day/week)
-- c-kh7bmP5HWh: Direction (more/less)
-- c-8Q-lH3S8xI: Archived
-- c-xWjyPFlv8q: Notes

with source as (
    select * from {{ source('raw_coda', 'coda__table_rows') }}
    where data->>'table_id' = 'grid-Wu3URkM3rF'
),

staged as (
    select
        -- Primary key
        data->>'row_id' as intent_id,

        -- Description (remove markdown code block formatting)
        regexp_replace(
            coalesce(data->'values'->>'c-UhKVwZKQUh', data->>'name'),
            '^```|```$', '', 'g'
        ) as description,

        -- Personal Category (extract name from relation object)
        case
            when data->'values'->>'c-xwuY2PtROo' in ('""', '') then null
            when data->'values'->>'c-xwuY2PtROo' is null then null
            when jsonb_typeof(data->'values'->'c-xwuY2PtROo') = 'object'
                then data->'values'->'c-xwuY2PtROo'->>'name'
            else null
        end as personal_category,

        -- Project (extract name from relation object)
        case
            when data->'values'->>'c-qJhTJfo3_d' in ('""', '') then null
            when data->'values'->>'c-qJhTJfo3_d' is null then null
            when jsonb_typeof(data->'values'->'c-qJhTJfo3_d') = 'object'
                then data->'values'->'c-qJhTJfo3_d'->>'name'
            else null
        end as project,

        -- Hours
        (data->'values'->>'c-MVk62_pLen')::numeric as hours,

        -- Unit (remove markdown code block formatting)
        regexp_replace(
            data->'values'->>'c-DfYJ5h1IZF',
            '^```|```$', '', 'g'
        ) as unit,

        -- Direction (remove markdown code block formatting)
        regexp_replace(
            data->'values'->>'c-kh7bmP5HWh',
            '^```|```$', '', 'g'
        ) as direction,

        -- Archived
        coalesce((data->'values'->>'c-8Q-lH3S8xI')::boolean, false) as is_archived,

        -- Notes
        nullif(data->'values'->>'c-xWjyPFlv8q', '') as notes,

        -- Audit columns
        synced_at,
        api_version

    from source
)

select * from staged
