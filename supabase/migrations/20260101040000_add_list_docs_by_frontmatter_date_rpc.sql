-- list_docs_by_frontmatter_date RPC function
-- Search by created/updated date in frontmatter (ISO 8601 format)

CREATE OR REPLACE FUNCTION list_docs_by_frontmatter_date(
  date_field TEXT DEFAULT 'created',  -- 'created' or 'updated'
  sort_order TEXT DEFAULT 'desc',
  after_date TIMESTAMPTZ DEFAULT NULL,
  before_date TIMESTAMPTZ DEFAULT NULL,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  file_path TEXT,
  title TEXT,
  tags JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.file_path,
    d.frontmatter->>'title' AS title,
    d.frontmatter->'tags' AS tags,
    (d.frontmatter->>'created')::timestamptz AS created_at,
    (d.frontmatter->>'updated')::timestamptz AS updated_at
  FROM raw.docs_github d
  WHERE
    -- Filter by date field
    CASE
      WHEN date_field = 'created' THEN
        (after_date IS NULL OR (d.frontmatter->>'created')::timestamptz >= after_date)
        AND (before_date IS NULL OR (d.frontmatter->>'created')::timestamptz <= before_date)
      WHEN date_field = 'updated' THEN
        (after_date IS NULL OR (d.frontmatter->>'updated')::timestamptz >= after_date)
        AND (before_date IS NULL OR (d.frontmatter->>'updated')::timestamptz <= before_date)
      ELSE TRUE
    END
    -- Ensure the date field exists
    AND d.frontmatter->>date_field IS NOT NULL
  ORDER BY
    CASE
      WHEN date_field = 'created' AND sort_order = 'asc' THEN (d.frontmatter->>'created')::timestamptz
    END ASC NULLS LAST,
    CASE
      WHEN date_field = 'created' AND sort_order = 'desc' THEN (d.frontmatter->>'created')::timestamptz
    END DESC NULLS LAST,
    CASE
      WHEN date_field = 'updated' AND sort_order = 'asc' THEN (d.frontmatter->>'updated')::timestamptz
    END ASC NULLS LAST,
    CASE
      WHEN date_field = 'updated' AND sort_order = 'desc' THEN (d.frontmatter->>'updated')::timestamptz
    END DESC NULLS LAST
  LIMIT match_count;
END;
$$;

-- Grant execute permission to anon role for MCP access
GRANT EXECUTE ON FUNCTION list_docs_by_frontmatter_date TO anon;
