{% macro exec_query(query) %}
    {% set results = run_query(query) %}
    {% if execute %}
        {% for row in results %}
            {{ log(row.values() | list, info=True) }}
        {% endfor %}
    {% endif %}
{% endmacro %}
