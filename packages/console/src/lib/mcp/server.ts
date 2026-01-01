/**
 * MCP Server for personal knowledge RAG search
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { QueryEmbedder } from "./embedder";
import { DocsRepository } from "./repository";

// No similarity threshold - return top N results by similarity
const SIMILARITY_THRESHOLD = 0;

export function createMcpServer(voyageApiKey: string): McpServer {
  const embedder = new QueryEmbedder(voyageApiKey);
  const repository = new DocsRepository();

  const server = new McpServer({
    name: "personal-knowledge",
    version: "1.0.0",
  });

  // search_docs tool
  server.tool(
    "search_docs",
    "Search personal documents using semantic similarity. Returns relevant chunks with titles and file paths.",
    {
      query: z.string().describe("Search query in natural language"),
      tags: z.array(z.string()).optional().describe("Filter by tags (optional)"),
      limit: z.number().default(5).describe("Number of results to return"),
    },
    async ({ query, tags, limit }) => {
      try {
        // Generate query embedding
        const queryEmbedding = await embedder.embedQuery(query);

        // Search chunks
        const results = await repository.searchChunks(
          queryEmbedding,
          tags ?? null,
          limit ?? 5,
          SIMILARITY_THRESHOLD
        );

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No matching documents found.",
              },
            ],
          };
        }

        // Format results
        const formatted = results.map((r) => ({
          title: r.title || "(untitled)",
          heading: r.heading,
          content: r.content,
          file_path: r.file_path,
          similarity: r.similarity.toFixed(3),
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // get_doc tool
  server.tool(
    "get_doc",
    "Get full content of a document by file path.",
    {
      file_path: z.string().describe("Document file path"),
    },
    async ({ file_path }) => {
      try {
        const doc = await repository.getDocument(file_path);

        if (!doc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Document not found: ${file_path}`,
              },
            ],
            isError: true,
          };
        }

        const tagsLine = doc.tags.length > 0 ? `Tags: ${doc.tags.join(", ")}\n\n` : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `# ${doc.title || "(untitled)"}\n\n${tagsLine}---\n\n${doc.content}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // list_docs_by_tag tool
  server.tool(
    "list_docs_by_tag",
    "List documents by tag. Use for browsing by category instead of semantic search. Supports random sampling.",
    {
      tag: z.string().describe("Tag to filter by (e.g., 'math', 'daily')"),
      limit: z.number().default(5).describe("Number of documents to return"),
      random: z.boolean().default(false).describe("If true, return random documents from the tag"),
    },
    async ({ tag, limit, random }) => {
      try {
        const docs = await repository.listDocsByTag(tag, limit ?? 5, random ?? false);

        if (docs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No documents found with tag: ${tag}`,
              },
            ],
          };
        }

        const formatted = docs.map((d) => ({
          title: d.title || "(untitled)",
          file_path: d.file_path,
          tags: d.tags,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // list_tags tool
  server.tool(
    "list_tags",
    "List all available tags with their usage count.",
    {},
    async () => {
      try {
        const tags = await repository.listTags();

        if (tags.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No tags found.",
              },
            ],
          };
        }

        const formatted = tags
          .map((t) => `${t.tag} (${t.count})`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: formatted,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // list_all_docs tool (no embedding required)
  server.tool(
    "list_all_docs",
    "List all documents with pagination. Use offset and limit to navigate through the entire collection. No embedding required.",
    {
      offset: z.number().default(0).describe("Starting position (0-indexed)"),
      limit: z.number().default(20).describe("Number of documents to return (max 100)"),
    },
    async ({ offset, limit }) => {
      try {
        const actualLimit = Math.min(limit ?? 20, 100); // Cap at 100
        const result = await repository.listAllDocs(offset ?? 0, actualLimit);

        if (result.docs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No documents found.",
              },
            ],
          };
        }

        const formatted = {
          docs: result.docs.map((d) => ({
            title: d.title || "(untitled)",
            file_path: d.file_path,
            tags: d.tags,
          })),
          pagination: {
            offset: offset ?? 0,
            limit: actualLimit,
            total_count: result.total_count,
            has_more: result.has_more,
          },
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // search_by_keyword tool (no embedding required)
  server.tool(
    "search_by_keyword",
    "Search documents by keywords in content. Supports multiple keywords (OR search) - useful for searching with synonyms. Returns matching documents with a snippet. No embedding required.",
    {
      keywords: z.array(z.string()).describe("Keywords to search for in document content (case-insensitive, OR logic)"),
      limit: z.number().default(10).describe("Number of results to return"),
    },
    async ({ keywords, limit }) => {
      try {
        if (!keywords || keywords.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No keywords provided.",
              },
            ],
            isError: true,
          };
        }

        const docs = await repository.searchByKeyword(keywords, limit ?? 10);

        if (docs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No documents found containing: ${keywords.join(", ")}`,
              },
            ],
          };
        }

        const formatted = docs.map((d) => ({
          title: d.title || "(untitled)",
          file_path: d.file_path,
          tags: d.tags,
          snippet: d.snippet,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // search_by_title tool (no embedding required)
  server.tool(
    "search_by_title",
    "Search documents by title using partial match. Fast and lightweight - no embedding required. Use when you know part of the document title.",
    {
      query: z.string().describe("Search query to match against document titles (case-insensitive)"),
      limit: z.number().default(10).describe("Number of results to return"),
    },
    async ({ query, limit }) => {
      try {
        const docs = await repository.searchByTitle(query, limit ?? 10);

        if (docs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No documents found with title matching: ${query}`,
              },
            ],
          };
        }

        const formatted = docs.map((d) => ({
          title: d.title || "(untitled)",
          file_path: d.file_path,
          tags: d.tags,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // list_docs_by_date tool (file path based)
  server.tool(
    "list_docs_by_date",
    "List documents by date extracted from file path (YYYYMMDD format). Use for finding oldest/newest files or filtering by date range based on file naming.",
    {
      sort: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' for oldest first, 'desc' for newest first"),
      after: z.string().optional().describe("Filter documents after this date (YYYYMMDD format, e.g., '20251201')"),
      before: z.string().optional().describe("Filter documents before this date (YYYYMMDD format, e.g., '20251207')"),
      limit: z.number().default(5).describe("Number of documents to return"),
    },
    async ({ sort, after, before, limit }) => {
      try {
        const docs = await repository.listDocsByDate(
          sort ?? "desc",
          after ?? null,
          before ?? null,
          limit ?? 5
        );

        if (docs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No documents found matching the criteria.",
              },
            ],
          };
        }

        const formatted = docs.map((d) => ({
          title: d.title || "(untitled)",
          file_path: d.file_path,
          created_date: d.created_date,
          tags: d.tags,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // list_docs_by_frontmatter_date tool (created/updated in frontmatter)
  server.tool(
    "list_docs_by_frontmatter_date",
    "List documents by created or updated date from frontmatter (ISO 8601). Use for finding recently created/modified documents or filtering by date range.",
    {
      date_field: z.enum(["created", "updated"]).default("created").describe("Which date field to use: 'created' or 'updated'"),
      sort: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' for oldest first, 'desc' for newest first"),
      after: z.string().optional().describe("Filter documents after this datetime (ISO 8601, e.g., '2025-12-01T00:00:00+09:00' or '2025-12-01')"),
      before: z.string().optional().describe("Filter documents before this datetime (ISO 8601, e.g., '2025-12-31T23:59:59+09:00' or '2025-12-31')"),
      limit: z.number().default(10).describe("Number of documents to return"),
    },
    async ({ date_field, sort, after, before, limit }) => {
      try {
        const docs = await repository.listDocsByFrontmatterDate(
          date_field ?? "created",
          sort ?? "desc",
          after ?? null,
          before ?? null,
          limit ?? 10
        );

        if (docs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No documents found matching the criteria.",
              },
            ],
          };
        }

        const formatted = docs.map((d) => ({
          title: d.title || "(untitled)",
          file_path: d.file_path,
          created_at: d.created_at,
          updated_at: d.updated_at,
          tags: d.tags,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
