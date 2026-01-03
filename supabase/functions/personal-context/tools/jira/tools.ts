// Jira MCP Tools
// Based on atlassian/mcp-server-atlassian patterns

import { ToolDefinition, McpToolResult } from "../../mcp/types.ts";
import * as jira from "./client.ts";

function formatResult(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function formatError(error: unknown): McpToolResult {
  const jiraError = error as jira.JiraApiError;
  const message = jiraError?.errorMessages?.join(", ") ||
    (error instanceof Error ? error.message : "Unknown error");
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function getJiraTools(): ToolDefinition[] {
  return [
    // =========================================================================
    // User
    // =========================================================================
    {
      name: "jira_get_myself",
      description: "Get information about the current Jira user (myself).",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: async (_params, _userId): Promise<McpToolResult> => {
        try {
          const user = await jira.getMyself();
          return formatResult(user);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Projects
    // =========================================================================
    {
      name: "jira_list_projects",
      description: "List all Jira projects accessible to the current user.",
      inputSchema: {
        type: "object",
        properties: {
          startAt: {
            type: "number",
            description: "Starting index for pagination. Default: 0",
          },
          maxResults: {
            type: "number",
            description: "Maximum results to return. Default: 50",
          },
        },
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { startAt = 0, maxResults = 50 } = params as {
            startAt?: number;
            maxResults?: number;
          };
          const response = await jira.listProjects(startAt, maxResults);
          return formatResult({
            total: response.total,
            projects: response.values.map((p) => ({
              key: p.key,
              name: p.name,
              type: p.projectTypeKey,
            })),
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "jira_get_project",
      description: "Get details of a specific Jira project.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Project key (e.g., 'PROJ') or ID. Required.",
          },
        },
        required: ["projectKey"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { projectKey } = params as { projectKey: string };
          const project = await jira.getProject(projectKey);
          return formatResult(project);
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Issues - Search & Get
    // =========================================================================
    {
      name: "jira_search",
      description:
        "Search for Jira issues using JQL (Jira Query Language). Example JQL: 'project = PROJ AND status = \"In Progress\"'",
      inputSchema: {
        type: "object",
        properties: {
          jql: {
            type: "string",
            description:
              "JQL query string. Example: 'project = PROJ AND status != Done ORDER BY created DESC'",
          },
          startAt: {
            type: "number",
            description: "Starting index for pagination. Default: 0",
          },
          maxResults: {
            type: "number",
            description: "Maximum results to return. Default: 50",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              "Fields to return. Default: summary, status, priority, assignee, created, updated",
          },
        },
        required: ["jql"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const {
            jql,
            startAt = 0,
            maxResults = 50,
            fields = ["summary", "status", "priority", "assignee", "created", "updated"],
          } = params as {
            jql: string;
            startAt?: number;
            maxResults?: number;
            fields?: string[];
          };

          const response = await jira.searchIssues(jql, startAt, maxResults, fields);
          return formatResult({
            total: response.total,
            issues: response.issues.map((issue) => ({
              key: issue.key,
              summary: issue.fields.summary,
              status: issue.fields.status?.name,
              priority: issue.fields.priority?.name,
              assignee: issue.fields.assignee?.displayName,
              created: issue.fields.created,
              updated: issue.fields.updated,
            })),
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "jira_get_issue",
      description: "Get details of a specific Jira issue by key or ID.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., 'PROJ-123') or ID. Required.",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description: "Specific fields to return. If not specified, returns common fields.",
          },
        },
        required: ["issueKey"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { issueKey, fields } = params as {
            issueKey: string;
            fields?: string[];
          };
          const issue = await jira.getIssue(issueKey, fields);
          return formatResult({
            key: issue.key,
            id: issue.id,
            summary: issue.fields.summary,
            description: issue.fields.description,
            status: issue.fields.status?.name,
            priority: issue.fields.priority?.name,
            type: issue.fields.issuetype?.name,
            assignee: issue.fields.assignee?.displayName,
            reporter: issue.fields.reporter?.displayName,
            labels: issue.fields.labels,
            project: issue.fields.project?.key,
            parent: issue.fields.parent?.key,
            created: issue.fields.created,
            updated: issue.fields.updated,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Issues - Create & Update
    // =========================================================================
    {
      name: "jira_create_issue",
      description: "Create a new Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Project key (e.g., 'PROJ'). Required.",
          },
          issueType: {
            type: "string",
            description: "Issue type (e.g., 'Task', 'Bug', 'Story', 'Epic'). Required.",
          },
          summary: {
            type: "string",
            description: "Issue summary/title. Required.",
          },
          description: {
            type: "string",
            description: "Issue description.",
          },
          assigneeAccountId: {
            type: "string",
            description: "Assignee's Atlassian account ID.",
          },
          priority: {
            type: "string",
            description: "Priority name (e.g., 'High', 'Medium', 'Low').",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to add to the issue.",
          },
          parentKey: {
            type: "string",
            description: "Parent issue key for subtasks.",
          },
        },
        required: ["projectKey", "issueType", "summary"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const {
            projectKey,
            issueType,
            summary,
            description,
            assigneeAccountId,
            priority,
            labels,
            parentKey,
          } = params as jira.CreateIssueParams;

          const issue = await jira.createIssue({
            projectKey,
            issueType,
            summary,
            description,
            assigneeAccountId,
            priority,
            labels,
            parentKey,
          });

          return formatResult({
            created: true,
            key: issue.key,
            id: issue.id,
            self: issue.self,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "jira_update_issue",
      description: "Update an existing Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., 'PROJ-123'). Required.",
          },
          summary: {
            type: "string",
            description: "New summary/title.",
          },
          description: {
            type: "string",
            description: "New description.",
          },
          assigneeAccountId: {
            type: "string",
            description: "New assignee's Atlassian account ID.",
          },
          priority: {
            type: "string",
            description: "New priority name.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "New labels (replaces existing).",
          },
        },
        required: ["issueKey"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { issueKey, ...updateParams } = params as {
            issueKey: string;
            summary?: string;
            description?: string;
            assigneeAccountId?: string;
            priority?: string;
            labels?: string[];
          };

          await jira.updateIssue({ issueKeyOrId: issueKey, ...updateParams });

          return formatResult({ updated: true, issueKey });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Transitions
    // =========================================================================
    {
      name: "jira_get_transitions",
      description:
        "Get available transitions for an issue. Use this to find valid transition IDs before changing issue status.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., 'PROJ-123'). Required.",
          },
        },
        required: ["issueKey"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { issueKey } = params as { issueKey: string };
          const response = await jira.getTransitions(issueKey);
          return formatResult({
            issueKey,
            transitions: response.transitions.map((t) => ({
              id: t.id,
              name: t.name,
              to: t.to.name,
            })),
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "jira_transition_issue",
      description:
        "Transition an issue to a new status. Use jira_get_transitions first to get valid transition IDs.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., 'PROJ-123'). Required.",
          },
          transitionId: {
            type: "string",
            description: "Transition ID (get from jira_get_transitions). Required.",
          },
          comment: {
            type: "string",
            description: "Optional comment to add with the transition.",
          },
        },
        required: ["issueKey", "transitionId"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { issueKey, transitionId, comment } = params as {
            issueKey: string;
            transitionId: string;
            comment?: string;
          };

          await jira.transitionIssue(issueKey, transitionId, comment);

          return formatResult({ transitioned: true, issueKey, transitionId });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    // =========================================================================
    // Comments
    // =========================================================================
    {
      name: "jira_get_comments",
      description: "Get comments on a Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., 'PROJ-123'). Required.",
          },
          startAt: {
            type: "number",
            description: "Starting index for pagination. Default: 0",
          },
          maxResults: {
            type: "number",
            description: "Maximum results to return. Default: 50",
          },
        },
        required: ["issueKey"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { issueKey, startAt = 0, maxResults = 50 } = params as {
            issueKey: string;
            startAt?: number;
            maxResults?: number;
          };

          const response = await jira.getComments(issueKey, startAt, maxResults);
          return formatResult({
            issueKey,
            total: response.total,
            comments: response.comments.map((c) => ({
              id: c.id,
              author: c.author.displayName,
              created: c.created,
              updated: c.updated,
              body: c.body,
            })),
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },

    {
      name: "jira_add_comment",
      description: "Add a comment to a Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., 'PROJ-123'). Required.",
          },
          body: {
            type: "string",
            description: "Comment text. Required.",
          },
        },
        required: ["issueKey", "body"],
      },
      handler: async (params, _userId): Promise<McpToolResult> => {
        try {
          const { issueKey, body } = params as { issueKey: string; body: string };

          const comment = await jira.addComment(issueKey, body);

          return formatResult({
            added: true,
            issueKey,
            commentId: comment.id,
            created: comment.created,
          });
        } catch (error) {
          return formatError(error);
        }
      },
    },
  ];
}
