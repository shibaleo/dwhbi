import { ToolDefinition, McpToolResult } from "../../mcp/types.ts";
import { embedQuery } from "./embedder.ts";
import * as repository from "./repository.ts";

const SIMILARITY_THRESHOLD = 0;

export const ragTools: ToolDefinition[] = [
  {
    name: "search_docs",
    description:
      "Search personal documents using semantic similarity. Returns relevant chunks with titles and file paths.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query in natural language" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags (optional)",
        },
        limit: { type: "number", default: 5, description: "Number of results to return" },
      },
      required: ["query"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { query, tags, limit = 5 } = params as {
        query: string;
        tags?: string[];
        limit?: number;
      };

      const queryEmbedding = await embedQuery(query);
      const results = await repository.searchChunks(
        queryEmbedding,
        tags || null,
        limit,
        SIMILARITY_THRESHOLD
      );

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No matching documents found." }] };
      }

      const formatted = results.map((r) => ({
        title: r.title || "(untitled)",
        heading: r.heading,
        content: r.content,
        file_path: r.file_path,
        similarity: r.similarity.toFixed(3),
      }));

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },

  {
    name: "get_doc",
    description: "Get full content of a document by file path.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Document file path" },
      },
      required: ["file_path"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { file_path } = params as { file_path: string };
      const doc = await repository.getDocument(file_path);

      if (!doc) {
        return {
          content: [{ type: "text", text: `Document not found: ${file_path}` }],
          isError: true,
        };
      }

      const tagsLine = doc.tags.length > 0 ? `Tags: ${doc.tags.join(", ")}\n\n` : "";

      return {
        content: [{
          type: "text",
          text: `# ${doc.title || "(untitled)"}\n\n${tagsLine}---\n\n${doc.content}`,
        }],
      };
    },
  },

  {
    name: "list_tags",
    description: "List all available tags with their usage count.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_params, _userId): Promise<McpToolResult> => {
      const tags = await repository.listTags();

      if (tags.length === 0) {
        return { content: [{ type: "text", text: "No tags found." }] };
      }

      const formatted = tags.map((t) => `${t.tag} (${t.count})`).join("\n");
      return { content: [{ type: "text", text: formatted }] };
    },
  },

  {
    name: "list_docs_by_tag",
    description:
      "List documents by tag. Use for browsing by category instead of semantic search. Supports random sampling.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Tag to filter by" },
        limit: { type: "number", default: 5, description: "Number of documents to return" },
        random: { type: "boolean", default: false, description: "If true, return random documents" },
      },
      required: ["tag"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { tag, limit = 5, random = false } = params as {
        tag: string;
        limit?: number;
        random?: boolean;
      };

      const docs = await repository.listDocsByTag(tag, limit, random);

      if (docs.length === 0) {
        return { content: [{ type: "text", text: `No documents found with tag: ${tag}` }] };
      }

      const formatted = docs.map((d) => ({
        title: d.title || "(untitled)",
        file_path: d.file_path,
        tags: d.tags,
      }));

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },

  {
    name: "list_all_docs",
    description: "List all documents with pagination. No embedding required.",
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number", default: 0, description: "Starting position" },
        limit: { type: "number", default: 20, description: "Number of documents (max 100)" },
      },
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { offset = 0, limit = 20 } = params as { offset?: number; limit?: number };
      const actualLimit = Math.min(limit, 100);
      const result = await repository.listAllDocs(offset, actualLimit);

      if (result.docs.length === 0) {
        return { content: [{ type: "text", text: "No documents found." }] };
      }

      const formatted = {
        docs: result.docs.map((d) => ({
          title: d.title || "(untitled)",
          file_path: d.file_path,
          tags: d.tags,
        })),
        pagination: {
          offset,
          limit: actualLimit,
          total_count: result.total_count,
          has_more: result.has_more,
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },

  {
    name: "search_by_keyword",
    description:
      "Search documents by keywords in content. Supports multiple keywords (OR search). No embedding required.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Keywords to search for (case-insensitive, OR logic)",
        },
        limit: { type: "number", default: 10, description: "Number of results" },
      },
      required: ["keywords"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { keywords, limit = 10 } = params as { keywords: string[]; limit?: number };

      if (!keywords || keywords.length === 0) {
        return { content: [{ type: "text", text: "No keywords provided." }], isError: true };
      }

      const docs = await repository.searchByKeyword(keywords, limit);

      if (docs.length === 0) {
        return {
          content: [{ type: "text", text: `No documents found containing: ${keywords.join(", ")}` }],
        };
      }

      const formatted = docs.map((d) => ({
        title: d.title || "(untitled)",
        file_path: d.file_path,
        tags: d.tags,
        snippet: d.snippet,
      }));

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },

  {
    name: "search_by_title",
    description: "Search documents by title using partial match. No embedding required.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (case-insensitive)" },
        limit: { type: "number", default: 10, description: "Number of results" },
      },
      required: ["query"],
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { query, limit = 10 } = params as { query: string; limit?: number };
      const docs = await repository.searchByTitle(query, limit);

      if (docs.length === 0) {
        return {
          content: [{ type: "text", text: `No documents found with title matching: ${query}` }],
        };
      }

      const formatted = docs.map((d) => ({
        title: d.title || "(untitled)",
        file_path: d.file_path,
        tags: d.tags,
      }));

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },

  {
    name: "list_docs_by_date",
    description:
      "List documents by date extracted from file path (YYYYMMDD format). No embedding required.",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", enum: ["asc", "desc"], default: "desc", description: "Sort order" },
        after: { type: "string", description: "Filter after this date (YYYYMMDD)" },
        before: { type: "string", description: "Filter before this date (YYYYMMDD)" },
        limit: { type: "number", default: 5, description: "Number of documents" },
      },
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { sort = "desc", after, before, limit = 5 } = params as {
        sort?: "asc" | "desc";
        after?: string;
        before?: string;
        limit?: number;
      };

      const docs = await repository.listDocsByDate(sort, after || null, before || null, limit);

      if (docs.length === 0) {
        return { content: [{ type: "text", text: "No documents found matching the criteria." }] };
      }

      const formatted = docs.map((d) => ({
        title: d.title || "(untitled)",
        file_path: d.file_path,
        created_date: d.created_date,
        tags: d.tags,
      }));

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },

  {
    name: "list_docs_by_frontmatter_date",
    description:
      "List documents by created or updated date from frontmatter (ISO 8601). No embedding required.",
    inputSchema: {
      type: "object",
      properties: {
        date_field: {
          type: "string",
          enum: ["created", "updated"],
          default: "created",
          description: "Which date field to use",
        },
        sort: { type: "string", enum: ["asc", "desc"], default: "desc", description: "Sort order" },
        after: { type: "string", description: "Filter after this datetime (ISO 8601)" },
        before: { type: "string", description: "Filter before this datetime (ISO 8601)" },
        limit: { type: "number", default: 10, description: "Number of documents" },
      },
    },
    handler: async (params, _userId): Promise<McpToolResult> => {
      const { date_field = "created", sort = "desc", after, before, limit = 10 } = params as {
        date_field?: "created" | "updated";
        sort?: "asc" | "desc";
        after?: string;
        before?: string;
        limit?: number;
      };

      const docs = await repository.listDocsByFrontmatterDate(
        date_field,
        sort,
        after || null,
        before || null,
        limit
      );

      if (docs.length === 0) {
        return { content: [{ type: "text", text: "No documents found matching the criteria." }] };
      }

      const formatted = docs.map((d) => ({
        title: d.title || "(untitled)",
        file_path: d.file_path,
        created_at: d.created_at,
        updated_at: d.updated_at,
        tags: d.tags,
      }));

      return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    },
  },
];
