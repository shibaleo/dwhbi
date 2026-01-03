// Notion MCP Tools
// Based on official Notion MCP Server patterns

import { ToolDefinition, McpToolResult } from "../../mcp/types.ts";
import * as notion from "./client.ts";

function formatResult(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function formatError(error: unknown): McpToolResult {
  const message = error instanceof Error
    ? error.message
    : (error as notion.NotionApiError)?.message || "Unknown error";
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function getNotionTools(): ToolDefinition[] {
  return [
    // =========================================================================
    // Search
    // =========================================================================
    {
      name: "notion_search",
      description: "Search pages and databases in Notion by title. Returns pages and databases shared with the integration.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to match against page/database titles. If empty, returns all shared content.",
          },
          filter_type: {
            type: "string",
            enum: ["page", "database"],
            description: "Filter results to only pages or only databases",
          },
          page_size: {
            type: "number",
            description: "Number of results to return (max 100)",
            default: 10,
          },
        },
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { query, filter_type, page_size = 10 } = params as {
            query?: string;
            filter_type?: "page" | "database";
            page_size?: number;
          };

          const searchParams: notion.SearchParams = {
            page_size: Math.min(page_size, 100),
          };

          if (query) searchParams.query = query;
          if (filter_type) {
            searchParams.filter = { property: "object", value: filter_type };
          }

          const result = await notion.search(searchParams);
          return formatResult({
            results: result.results,
            has_more: result.has_more,
            next_cursor: result.next_cursor,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Pages
    // =========================================================================
    {
      name: "notion_get_page",
      description: "Retrieve a Notion page by ID. Returns page properties and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to retrieve (UUID format, with or without dashes)",
          },
        },
        required: ["page_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { page_id } = params as { page_id: string };
          const page = await notion.retrievePage(page_id);
          return formatResult(page);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_get_page_content",
      description: "Get the content (blocks) of a Notion page. Use this to read the actual text content.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to get content from",
          },
          page_size: {
            type: "number",
            description: "Number of blocks to return (max 100)",
            default: 50,
          },
        },
        required: ["page_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { page_id, page_size = 50 } = params as { page_id: string; page_size?: number };
          const blocks = await notion.retrieveBlockChildren(page_id, {
            page_size: Math.min(page_size, 100),
          });
          return formatResult({
            blocks: blocks.results,
            has_more: blocks.has_more,
            next_cursor: blocks.next_cursor,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_create_page",
      description: "Create a new page in Notion. Can create as a child of another page or in a database.",
      inputSchema: {
        type: "object",
        properties: {
          parent_page_id: {
            type: "string",
            description: "Parent page ID (use this OR parent_database_id)",
          },
          parent_database_id: {
            type: "string",
            description: "Parent database ID (use this OR parent_page_id)",
          },
          title: {
            type: "string",
            description: "Page title",
          },
          properties: {
            type: "object",
            description: "Page properties (for database pages). Keys are property names.",
          },
        },
        required: ["title"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { parent_page_id, parent_database_id, title, properties } = params as {
            parent_page_id?: string;
            parent_database_id?: string;
            title: string;
            properties?: Record<string, unknown>;
          };

          if (!parent_page_id && !parent_database_id) {
            return formatError(new Error("Either parent_page_id or parent_database_id is required"));
          }

          const parent = parent_database_id
            ? { database_id: parent_database_id }
            : { page_id: parent_page_id! };

          // Build properties - for database pages, use provided properties
          // For regular pages, create title property
          const pageProperties = parent_database_id
            ? {
                ...properties,
                // Ensure title is set (usually "Name" or "Title" property)
                ...(properties?.Name ? {} : properties?.Title ? {} : { Name: { title: [{ text: { content: title } }] } }),
              }
            : {
                title: { title: [{ text: { content: title } }] },
              };

          const page = await notion.createPage({
            parent,
            properties: pageProperties,
          });

          return formatResult(page);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_update_page",
      description: "Update a Notion page's properties.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to update",
          },
          properties: {
            type: "object",
            description: "Properties to update. Keys are property names.",
          },
        },
        required: ["page_id", "properties"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { page_id, properties } = params as {
            page_id: string;
            properties: Record<string, unknown>;
          };
          const page = await notion.updatePage(page_id, properties);
          return formatResult(page);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Databases
    // =========================================================================
    {
      name: "notion_get_database",
      description: "Retrieve a Notion database schema and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: {
            type: "string",
            description: "The ID of the database to retrieve",
          },
        },
        required: ["database_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { database_id } = params as { database_id: string };
          const database = await notion.retrieveDatabase(database_id);
          return formatResult(database);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_query_database",
      description: "Query a Notion database with optional filters and sorts. Returns pages in the database.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: {
            type: "string",
            description: "The ID of the database to query",
          },
          filter: {
            type: "object",
            description: "Filter object (Notion filter format)",
          },
          sorts: {
            type: "array",
            description: "Sort specifications",
            items: {
              type: "object",
              properties: {
                property: { type: "string" },
                direction: { type: "string", enum: ["ascending", "descending"] },
              },
            },
          },
          page_size: {
            type: "number",
            description: "Number of results to return (max 100)",
            default: 10,
          },
        },
        required: ["database_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { database_id, filter, sorts, page_size = 10 } = params as {
            database_id: string;
            filter?: Record<string, unknown>;
            sorts?: Array<{ property?: string; timestamp?: string; direction: "ascending" | "descending" }>;
            page_size?: number;
          };

          const result = await notion.queryDatabase(database_id, {
            filter,
            sorts,
            page_size: Math.min(page_size, 100),
          });

          return formatResult({
            results: result.results,
            has_more: result.has_more,
            next_cursor: result.next_cursor,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Blocks
    // =========================================================================
    {
      name: "notion_append_blocks",
      description: "Append content blocks to a page or block. Use to add text, headings, lists, etc.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: {
            type: "string",
            description: "The ID of the page or block to append to",
          },
          blocks: {
            type: "array",
            description: "Array of block objects to append",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  description: "Block type: paragraph, heading_1, heading_2, heading_3, bulleted_list_item, numbered_list_item, to_do, toggle, code, quote, callout, divider",
                },
                content: {
                  type: "string",
                  description: "Text content for the block",
                },
              },
              required: ["type"],
            },
          },
        },
        required: ["block_id", "blocks"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { block_id, blocks } = params as {
            block_id: string;
            blocks: Array<{ type: string; content?: string; checked?: boolean; language?: string }>;
          };

          // Convert simple block format to Notion block format
          const notionBlocks = blocks.map((block) => {
            const richText = block.content
              ? [{ type: "text", text: { content: block.content } }]
              : [];

            switch (block.type) {
              case "paragraph":
                return { object: "block", type: "paragraph", paragraph: { rich_text: richText } };
              case "heading_1":
                return { object: "block", type: "heading_1", heading_1: { rich_text: richText } };
              case "heading_2":
                return { object: "block", type: "heading_2", heading_2: { rich_text: richText } };
              case "heading_3":
                return { object: "block", type: "heading_3", heading_3: { rich_text: richText } };
              case "bulleted_list_item":
                return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText } };
              case "numbered_list_item":
                return { object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: richText } };
              case "to_do":
                return { object: "block", type: "to_do", to_do: { rich_text: richText, checked: block.checked ?? false } };
              case "toggle":
                return { object: "block", type: "toggle", toggle: { rich_text: richText } };
              case "code":
                return { object: "block", type: "code", code: { rich_text: richText, language: block.language || "plain text" } };
              case "quote":
                return { object: "block", type: "quote", quote: { rich_text: richText } };
              case "callout":
                return { object: "block", type: "callout", callout: { rich_text: richText } };
              case "divider":
                return { object: "block", type: "divider", divider: {} };
              default:
                return { object: "block", type: "paragraph", paragraph: { rich_text: richText } };
            }
          });

          const result = await notion.appendBlockChildren(block_id, notionBlocks as notion.NotionBlock[]);
          return formatResult({
            blocks: result.results,
            has_more: result.has_more,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_delete_block",
      description: "Delete a block from Notion. This also deletes all children of the block.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: {
            type: "string",
            description: "The ID of the block to delete",
          },
        },
        required: ["block_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { block_id } = params as { block_id: string };
          const block = await notion.deleteBlock(block_id);
          return formatResult({ deleted: true, block });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Comments
    // =========================================================================
    {
      name: "notion_list_comments",
      description: "List comments on a Notion page or block.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: {
            type: "string",
            description: "The ID of the page or block to get comments from",
          },
          page_size: {
            type: "number",
            description: "Number of comments to return (max 100)",
            default: 50,
          },
        },
        required: ["block_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { block_id, page_size = 50 } = params as { block_id: string; page_size?: number };
          const result = await notion.listComments(block_id, {
            page_size: Math.min(page_size, 100),
          });
          return formatResult({
            comments: result.results,
            has_more: result.has_more,
            next_cursor: result.next_cursor,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_add_comment",
      description: "Add a comment to a Notion page.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to comment on",
          },
          content: {
            type: "string",
            description: "Comment text content",
          },
        },
        required: ["page_id", "content"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { page_id, content } = params as { page_id: string; content: string };
          const comment = await notion.createComment({
            parent: { page_id },
            rich_text: [{ text: { content } }],
          });
          return formatResult(comment);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Users
    // =========================================================================
    {
      name: "notion_list_users",
      description: "List all users in the Notion workspace.",
      inputSchema: {
        type: "object",
        properties: {
          page_size: {
            type: "number",
            description: "Number of users to return (max 100)",
            default: 50,
          },
        },
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { page_size = 50 } = params as { page_size?: number };
          const result = await notion.listUsers({
            page_size: Math.min(page_size, 100),
          });
          return formatResult({
            users: result.results,
            has_more: result.has_more,
            next_cursor: result.next_cursor,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_get_user",
      description: "Get information about a Notion user.",
      inputSchema: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "The ID of the user to retrieve",
          },
        },
        required: ["user_id"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { user_id } = params as { user_id: string };
          const user = await notion.retrieveUser(user_id);
          return formatResult(user);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "notion_get_bot_user",
      description: "Get information about the current integration bot user.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        try {
          const user = await notion.retrieveBotUser();
          return formatResult(user);
        } catch (error) {
          return formatError(error);
        }
      },
    },
  ];
}
