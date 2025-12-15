-- mst_personal_time_category.sql
-- =============================================================================
-- Core master: Personal time categories with Toggl color mapping
-- Integrates:
--   - stg_coda__mst_personal_time_category: Category definitions
--   - stg_coda__map_toggl_color_to_personal: Color to category mapping
-- =============================================================================

with personal_categories as (
    select
        name,
        name_ja,
        description,
        coarse_category,
        sort_order
    from {{ ref('stg_coda__mst_personal_time_category') }}
),

color_mapping as (
    select
        toggl_color_hex,
        toggl_color_name,
        time_category_personal
    from {{ ref('stg_coda__map_toggl_color_to_personal') }}
)

select
    pc.name,
    pc.name_ja,
    pc.description,
    pc.coarse_category,
    pc.sort_order,
    array_agg(distinct cm.toggl_color_hex order by cm.toggl_color_hex) filter (where cm.toggl_color_hex is not null) as color_hex_codes,
    array_agg(distinct cm.toggl_color_name order by cm.toggl_color_name) filter (where cm.toggl_color_name is not null) as color_names
from personal_categories pc
left join color_mapping cm on cm.time_category_personal = pc.name
group by pc.name, pc.name_ja, pc.description, pc.coarse_category, pc.sort_order
order by pc.sort_order
