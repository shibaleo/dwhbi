/**
 * MCP Server for personal knowledge RAG search
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { QueryEmbedder } from "./embedder";
import { DocsRepository } from "./repository";

const SIMILARITY_THRESHOLD = 0.5;

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

  return server;
}
