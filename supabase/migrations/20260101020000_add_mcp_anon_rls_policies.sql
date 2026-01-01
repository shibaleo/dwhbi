-- Add RLS policies for anon role to read rag schema tables and raw.docs_github
-- This allows the MCP server (remote HTTP) to access data without authentication

-- Allow anon to read docs_github (for get_doc)
CREATE POLICY "Anon can read docs_github"
    ON raw.docs_github
    FOR SELECT
    TO anon
    USING (true);

-- Allow anon to read chunks (for search_docs via search_chunks RPC)
CREATE POLICY "Anon can read chunks"
    ON rag.chunks
    FOR SELECT
    TO anon
    USING (true);

-- Grant USAGE on schemas to anon role
GRANT USAGE ON SCHEMA raw TO anon;
GRANT USAGE ON SCHEMA rag TO anon;

-- Grant SELECT on tables to anon role
GRANT SELECT ON raw.docs_github TO anon;
GRANT SELECT ON rag.chunks TO anon;

-- Grant EXECUTE on RPC functions to anon role
GRANT EXECUTE ON FUNCTION search_chunks(vector(512), text[], int, float) TO anon;
GRANT EXECUTE ON FUNCTION list_all_tags() TO anon;
