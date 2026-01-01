-- list_docs_by_date RPC function
-- Extracts date from file_path (format: YYYYMMDD...) and allows filtering/sorting

CREATE OR REPLACE FUNCTION list_docs_by_date(
  sort_order TEXT DEFAULT 'desc',
  after_date TEXT DEFAULT NULL,
  before_date TEXT DEFAULT NULL,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  file_path TEXT,
  title TEXT,
  tags JSONB,
  created_date TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH docs_with_date AS (
    SELECT
      d.file_path,
      d.frontmatter->>'title' AS title,
      d.frontmatter->'tags' AS tags,
      SUBSTRING(d.file_path FROM '(\d{8})') AS created_date
    FROM raw.docs_github d
    WHERE SUBSTRING(d.file_path FROM '(\d{8})') IS NOT NULL
  )
  SELECT
    dwd.file_path,
    dwd.title,
    dwd.tags,
    dwd.created_date
  FROM docs_with_date dwd
  WHERE
    (after_date IS NULL OR dwd.created_date >= after_date)
    AND (before_date IS NULL OR dwd.created_date <= before_date)
  ORDER BY
    CASE WHEN sort_order = 'asc' THEN dwd.created_date END ASC,
    CASE WHEN sort_order = 'desc' THEN dwd.created_date END DESC
  LIMIT match_count;
END;
$$;

-- Grant execute permission to anon role for MCP access
GRANT EXECUTE ON FUNCTION list_docs_by_date TO anon;
