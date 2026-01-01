-- Add list_all_tags RPC function for MCP server
-- Returns all unique tags with their usage count

CREATE OR REPLACE FUNCTION list_all_tags()
RETURNS TABLE (
    tag text,
    count bigint
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        t.tag,
        COUNT(*) as count
    FROM raw.docs_github d,
        LATERAL jsonb_array_elements_text(d.frontmatter->'tags') AS t(tag)
    GROUP BY t.tag
    ORDER BY count DESC, t.tag;
$$;

COMMENT ON FUNCTION list_all_tags IS 'Returns all unique tags from documents with their usage count';
