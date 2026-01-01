-- RAG Embedding Tables Migration
-- Creates tables for document storage and vector search

-- =============================================================================
-- Prerequisites
-- =============================================================================

-- pgvector extension (should already be enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS vector;

-- rag schema
CREATE SCHEMA IF NOT EXISTS rag;

-- =============================================================================
-- raw.docs_github - Raw markdown documents from GitHub
-- =============================================================================

CREATE TABLE raw.docs_github (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL UNIQUE,
    frontmatter JSONB NOT NULL DEFAULT '{}',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE raw.docs_github IS 'Raw markdown documents fetched from GitHub Contents API';
COMMENT ON COLUMN raw.docs_github.file_path IS 'File path within the GitHub repository';
COMMENT ON COLUMN raw.docs_github.frontmatter IS 'Parsed YAML frontmatter as JSONB';
COMMENT ON COLUMN raw.docs_github.content IS 'Markdown content after frontmatter';
COMMENT ON COLUMN raw.docs_github.content_hash IS 'SHA256 hash for change detection';

CREATE INDEX docs_github_frontmatter_tags_idx
    ON raw.docs_github USING GIN ((frontmatter->'tags'));

-- =============================================================================
-- raw.sync_state - Connector sync state tracking
-- =============================================================================

CREATE TABLE raw.sync_state (
    source TEXT PRIMARY KEY,
    last_synced_sha TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE raw.sync_state IS 'Tracks last synced commit SHA for incremental sync';

-- =============================================================================
-- rag.chunks - Chunked documents with embeddings
-- =============================================================================

CREATE TABLE rag.chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    parent_heading TEXT NOT NULL,
    heading TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chunks_document_chunk_key UNIQUE (document_id, chunk_index)
);

COMMENT ON TABLE rag.chunks IS 'Document chunks with Voyage AI embeddings (512 dimensions)';
COMMENT ON COLUMN rag.chunks.parent_heading IS 'Parent heading (h1, title, or filename slug)';
COMMENT ON COLUMN rag.chunks.heading IS 'Chunk heading (h2)';
COMMENT ON COLUMN rag.chunks.embedding IS 'Voyage AI voyage-3-lite embedding vector';

CREATE INDEX chunks_document_id_idx ON rag.chunks (document_id);

-- Note: ivfflat index should be created after initial data load
-- CREATE INDEX chunks_embedding_idx ON rag.chunks
--     USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 100);

-- =============================================================================
-- rag.embedding_state - Embedding generation state tracking
-- =============================================================================

CREATE TABLE rag.embedding_state (
    document_id UUID PRIMARY KEY REFERENCES raw.docs_github(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rag.embedding_state IS 'Tracks which documents have been embedded and their content hash';

-- =============================================================================
-- Views
-- =============================================================================

CREATE VIEW rag.documents_with_metadata AS
SELECT
    d.id,
    d.file_path,
    d.frontmatter->>'title' AS title,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'tags')) AS tags,
    ARRAY(SELECT jsonb_array_elements_text(d.frontmatter->'aliases')) AS aliases,
    d.content_hash
FROM raw.docs_github d;

COMMENT ON VIEW rag.documents_with_metadata IS 'Convenience view for document metadata access';

-- =============================================================================
-- RPC Functions
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
    JOIN raw.docs_github d ON c.document_id = d.id
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
    FROM raw.docs_github d
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
    FROM raw.docs_github d1
    CROSS JOIN LATERAL jsonb_array_elements_text(d1.frontmatter->'previous') AS prev_file
    JOIN raw.docs_github d2 ON d2.file_path ~ (prev_file || '\.md$')
    WHERE d1.frontmatter ? 'previous';
END;
$$;

COMMENT ON FUNCTION get_superseded_document_ids IS 'Returns document IDs that are superseded by newer versions (based on previous field)';

-- =============================================================================
-- RLS Policies
-- =============================================================================

-- Enable RLS
ALTER TABLE raw.docs_github ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.embedding_state ENABLE ROW LEVEL SECURITY;

-- Service role full access (for connectors/analyzers)
CREATE POLICY "Service role full access on docs_github"
    ON raw.docs_github
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access on sync_state"
    ON raw.sync_state
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access on chunks"
    ON rag.chunks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access on embedding_state"
    ON rag.embedding_state
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users can read (for MCP server)
CREATE POLICY "Authenticated users can read docs_github"
    ON raw.docs_github
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read chunks"
    ON rag.chunks
    FOR SELECT
    TO authenticated
    USING (true);
