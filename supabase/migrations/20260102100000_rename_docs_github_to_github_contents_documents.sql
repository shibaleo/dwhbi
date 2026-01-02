-- Rename raw.docs_github to raw.github_contents__documents
-- =============================================================================
-- This migration renames the table to follow the naming convention:
-- {source}__{entity} (e.g., github_contents__documents)
-- =============================================================================

-- =============================================================================
-- Step 1: Drop dependent objects (views, functions, policies)
-- =============================================================================

-- Drop view
DROP VIEW IF EXISTS rag.documents_with_metadata;

-- Drop RPC functions that reference the old table
DROP FUNCTION IF EXISTS search_chunks(vector(512), text[], int, float);
DROP FUNCTION IF EXISTS get_documents_needing_embedding();
DROP FUNCTION IF EXISTS get_superseded_document_ids();
DROP FUNCTION IF EXISTS list_all_tags();
DROP FUNCTION IF EXISTS list_docs_by_date(text, text, text, int);
DROP FUNCTION IF EXISTS list_docs_by_frontmatter_date(text, text, text, text, int);
DROP FUNCTION IF EXISTS list_docs_by_frontmatter_date(text, text, timestamptz, timestamptz, int);

-- Drop RLS policies on old table
DROP POLICY IF EXISTS "Service role full access on docs_github" ON raw.docs_github;
DROP POLICY IF EXISTS "Authenticated users can read docs_github" ON raw.docs_github;
DROP POLICY IF EXISTS "Anon can read docs_github" ON raw.docs_github;

-- =============================================================================
-- Step 2: Rename the table
-- =============================================================================

ALTER TABLE raw.docs_github RENAME TO github_contents__documents;

-- Rename index
ALTER INDEX raw.docs_github_frontmatter_tags_idx
    RENAME TO github_contents__documents_frontmatter_tags_idx;

-- =============================================================================
-- Step 3: Update comments
-- =============================================================================

COMMENT ON TABLE raw.github_contents__documents IS 'Raw markdown documents fetched from GitHub Contents API';
COMMENT ON COLUMN raw.github_contents__documents.file_path IS 'File path within the GitHub repository';
COMMENT ON COLUMN raw.github_contents__documents.frontmatter IS 'Parsed YAML frontmatter as JSONB';
COMMENT ON COLUMN raw.github_contents__documents.content IS 'Markdown content after frontmatter';
COMMENT ON COLUMN raw.github_contents__documents.content_hash IS 'SHA256 hash for change detection';

-- =============================================================================
-- Step 4: Recreate view
-- =============================================================================

CREATE VIEW rag.documents_with_metadata AS
SELECT
    d.id,
    d.file_path,
    d.frontmatter->>'title' AS title,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'tags')) AS tags,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'aliases')) AS aliases,
    d.content_hash
FROM raw.github_contents__documents d;

COMMENT ON VIEW rag.documents_with_metadata IS 'Convenience view for document metadata access';

-- =============================================================================
-- Step 5: Recreate RPC functions
-- =============================================================================

-- Search chunks by vector similarity
CREATE OR REPLACE FUNCTION search_chunks(
    query_embedding vector(512),
    filter_tags text[] DEFAULT NULL,
    match_count int DEFAULT 5,
    similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE (
    id uuid,
    title text,
    heading text,
    content text,
    file_path text,
    similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        d.frontmatter->>'title' AS title,
        c.heading,
        c.content,
        d.file_path,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM rag.chunks c
    JOIN raw.github_contents__documents d ON c.document_id = d.id
    WHERE
        (filter_tags IS NULL OR d.frontmatter->'tags' ?| filter_tags)
        AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION search_chunks IS 'Vector similarity search with optional tag filtering';

-- Get documents needing embedding generation
CREATE OR REPLACE FUNCTION get_documents_needing_embedding()
RETURNS TABLE (
    id uuid,
    file_path text,
    frontmatter jsonb,
    content text,
    content_hash text
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.file_path,
        d.frontmatter,
        d.content,
        d.content_hash
    FROM raw.github_contents__documents d
    LEFT JOIN rag.embedding_state es ON d.id = es.document_id
    WHERE
        es.document_id IS NULL
        OR es.content_hash != d.content_hash;
END;
$$;

COMMENT ON FUNCTION get_documents_needing_embedding IS 'Returns documents that need embedding (new or changed)';

-- Get superseded document IDs (old versions)
CREATE OR REPLACE FUNCTION get_superseded_document_ids()
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT d2.id
    FROM raw.github_contents__documents d1
    CROSS JOIN LATERAL jsonb_array_elements_text(d1.frontmatter->'previous') AS prev_file
    JOIN raw.github_contents__documents d2 ON d2.file_path ~ (prev_file || '\.md$')
    WHERE d1.frontmatter ? 'previous';
END;
$$;

COMMENT ON FUNCTION get_superseded_document_ids IS 'Returns document IDs that are superseded by newer versions (based on previous field)';

-- List all tags with counts
CREATE OR REPLACE FUNCTION list_all_tags()
RETURNS TABLE (
    tag text,
    count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.tag,
        COUNT(*)::bigint AS count
    FROM raw.github_contents__documents d,
         LATERAL jsonb_array_elements_text(d.frontmatter->'tags') AS t(tag)
    GROUP BY t.tag
    ORDER BY count DESC, t.tag ASC;
END;
$$;

COMMENT ON FUNCTION list_all_tags IS 'Returns all tags with document counts';

-- List documents by date extracted from file path
CREATE OR REPLACE FUNCTION list_docs_by_date(
    sort_order text DEFAULT 'desc',
    after_date text DEFAULT NULL,
    before_date text DEFAULT NULL,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    file_path text,
    title text,
    tags text[],
    created_date text
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.file_path,
        d.frontmatter->>'title' AS title,
        ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'tags')) AS tags,
        (regexp_match(d.file_path, '(\d{8})'))[1] AS created_date
    FROM raw.github_contents__documents d
    WHERE
        d.file_path ~ '\d{8}'
        AND (after_date IS NULL OR (regexp_match(d.file_path, '(\d{8})'))[1] > after_date)
        AND (before_date IS NULL OR (regexp_match(d.file_path, '(\d{8})'))[1] < before_date)
    ORDER BY
        CASE WHEN sort_order = 'desc' THEN (regexp_match(d.file_path, '(\d{8})'))[1] END DESC,
        CASE WHEN sort_order = 'asc' THEN (regexp_match(d.file_path, '(\d{8})'))[1] END ASC
    LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION list_docs_by_date IS 'List documents by date extracted from file path (YYYYMMDD format)';

-- List documents by frontmatter date
CREATE OR REPLACE FUNCTION list_docs_by_frontmatter_date(
  date_field text DEFAULT 'created',
  sort_order text DEFAULT 'desc',
  after_date text DEFAULT NULL,
  before_date text DEFAULT NULL,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  file_path text,
  title text,
  tags text[],
  created_at text,
  updated_at text
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.file_path,
    d.frontmatter->>'title' AS title,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'tags')) AS tags,
    d.frontmatter->>'created' AS created_at,
    d.frontmatter->>'updated' AS updated_at
  FROM raw.github_contents__documents d
  WHERE
    d.frontmatter->>date_field IS NOT NULL
    AND (after_date IS NULL OR d.frontmatter->>date_field > after_date)
    AND (before_date IS NULL OR d.frontmatter->>date_field < before_date)
  ORDER BY
    CASE WHEN sort_order = 'desc' THEN d.frontmatter->>date_field END DESC,
    CASE WHEN sort_order = 'asc' THEN d.frontmatter->>date_field END ASC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION list_docs_by_frontmatter_date IS 'List documents by created or updated date from frontmatter';

-- =============================================================================
-- Step 6: Recreate RLS policies
-- =============================================================================

-- Service role full access
CREATE POLICY "Service role full access on github_contents__documents"
    ON raw.github_contents__documents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users can read
CREATE POLICY "Authenticated users can read github_contents__documents"
    ON raw.github_contents__documents
    FOR SELECT
    TO authenticated
    USING (true);

-- Anon can read
CREATE POLICY "Anon can read github_contents__documents"
    ON raw.github_contents__documents
    FOR SELECT
    TO anon
    USING (true);

-- =============================================================================
-- Step 7: Re-grant permissions
-- =============================================================================

GRANT SELECT ON raw.github_contents__documents TO anon;
