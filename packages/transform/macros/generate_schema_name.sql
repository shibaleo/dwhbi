{% macro generate_schema_name(custom_schema_name, node) -%}
    {#
        Override default schema naming behavior.

        dbt default: {target_schema}_{custom_schema_name}
        This override:
          - If custom_schema_name is specified → use it directly
          - If not specified → use target_schema (default)

        This follows dbt best practices for multi-schema projects.
        See: https://docs.getdbt.com/docs/build/custom-schemas
    #}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
