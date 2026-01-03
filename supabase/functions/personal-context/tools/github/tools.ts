// GitHub MCP Tools - 23 tools
import { ToolDefinition } from "../../mcp/types.ts";
import * as client from "./client.ts";

export function getGitHubTools(): ToolDefinition[] {
  return [
    // ==========================================================================
    // User (1)
    // ==========================================================================
    {
      name: "github_get_user",
      description: "Get information about the authenticated GitHub user.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      handler: async () => {
        const user = await client.getUser();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                login: user.login,
                name: user.name,
                email: user.email,
                html_url: user.html_url,
                public_repos: user.public_repos,
                followers: user.followers,
                following: user.following,
              }, null, 2),
            },
          ],
        };
      },
    },

    // ==========================================================================
    // Repositories (5)
    // ==========================================================================
    {
      name: "github_list_repos",
      description: "List repositories for the authenticated user.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["all", "owner", "public", "private"],
            description: "Type of repositories. Default: owner",
          },
          sort: {
            type: "string",
            enum: ["created", "updated", "pushed", "full_name"],
            description: "Sort by. Default: updated",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const repos = await client.listRepos(
          args.type as "all" | "owner" | "public" | "private" | undefined,
          args.sort as "created" | "updated" | "pushed" | "full_name" | undefined,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                repos.map((r) => ({
                  full_name: r.full_name,
                  private: r.private,
                  description: r.description,
                  language: r.language,
                  stargazers_count: r.stargazers_count,
                  updated_at: r.updated_at,
                  html_url: r.html_url,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_get_repo",
      description: "Get details of a specific repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const repo = await client.getRepo(
          args.owner as string,
          args.repo as string
        );
        return {
          content: [{ type: "text", text: JSON.stringify(repo, null, 2) }],
        };
      },
    },
    {
      name: "github_list_branches",
      description: "List branches in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const branches = await client.listBranches(
          args.owner as string,
          args.repo as string,
          args.perPage as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                branches.map((b) => ({
                  name: b.name,
                  sha: b.commit.sha.substring(0, 7),
                  protected: b.protected,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_list_commits",
      description: "List commits in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          sha: {
            type: "string",
            description: "Branch name or commit SHA to filter by.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const commits = await client.listCommits(
          args.owner as string,
          args.repo as string,
          args.sha as string | undefined,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                commits.map((c) => ({
                  sha: c.sha.substring(0, 7),
                  message: c.commit.message.split("\n")[0],
                  author: c.commit.author.name,
                  date: c.commit.author.date,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_get_file_content",
      description: "Get the content of a file in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          path: {
            type: "string",
            description: "File path. Required.",
          },
          ref: {
            type: "string",
            description: "Branch name or commit SHA.",
          },
        },
        required: ["owner", "repo", "path"],
      },
      handler: async (args: Record<string, unknown>) => {
        const content = await client.getFileContent(
          args.owner as string,
          args.repo as string,
          args.path as string,
          args.ref as string | undefined
        );
        let decodedContent = "";
        if (content.content && content.encoding === "base64") {
          decodedContent = atob(content.content.replace(/\n/g, ""));
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  name: content.name,
                  path: content.path,
                  sha: content.sha.substring(0, 7),
                  size: content.size,
                  html_url: content.html_url,
                  content: decodedContent,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },

    // ==========================================================================
    // Issues (5)
    // ==========================================================================
    {
      name: "github_list_issues",
      description: "List issues in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "Issue state. Default: open",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const issues = await client.listIssues(
          args.owner as string,
          args.repo as string,
          args.state as "open" | "closed" | "all" | undefined,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                issues.map((i) => ({
                  number: i.number,
                  title: i.title,
                  state: i.state,
                  user: i.user.login,
                  labels: i.labels.map((l) => l.name),
                  created_at: i.created_at,
                  html_url: i.html_url,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_get_issue",
      description: "Get details of a specific issue.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          issueNumber: {
            type: "number",
            description: "Issue number. Required.",
          },
        },
        required: ["owner", "repo", "issueNumber"],
      },
      handler: async (args: Record<string, unknown>) => {
        const issue = await client.getIssue(
          args.owner as string,
          args.repo as string,
          args.issueNumber as number
        );
        return {
          content: [{ type: "text", text: JSON.stringify(issue, null, 2) }],
        };
      },
    },
    {
      name: "github_create_issue",
      description: "Create a new issue in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          title: {
            type: "string",
            description: "Issue title. Required.",
          },
          body: {
            type: "string",
            description: "Issue body.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to assign.",
          },
          assignees: {
            type: "array",
            items: { type: "string" },
            description: "Users to assign.",
          },
        },
        required: ["owner", "repo", "title"],
      },
      handler: async (args: Record<string, unknown>) => {
        const issue = await client.createIssue({
          owner: args.owner as string,
          repo: args.repo as string,
          title: args.title as string,
          body: args.body as string | undefined,
          labels: args.labels as string[] | undefined,
          assignees: args.assignees as string[] | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  number: issue.number,
                  title: issue.title,
                  html_url: issue.html_url,
                  created_at: issue.created_at,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_update_issue",
      description: "Update an existing issue.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          issueNumber: {
            type: "number",
            description: "Issue number. Required.",
          },
          title: {
            type: "string",
            description: "New title.",
          },
          body: {
            type: "string",
            description: "New body.",
          },
          state: {
            type: "string",
            enum: ["open", "closed"],
            description: "New state.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to set.",
          },
          assignees: {
            type: "array",
            items: { type: "string" },
            description: "Users to assign.",
          },
        },
        required: ["owner", "repo", "issueNumber"],
      },
      handler: async (args: Record<string, unknown>) => {
        const issue = await client.updateIssue({
          owner: args.owner as string,
          repo: args.repo as string,
          issueNumber: args.issueNumber as number,
          title: args.title as string | undefined,
          body: args.body as string | undefined,
          state: args.state as "open" | "closed" | undefined,
          labels: args.labels as string[] | undefined,
          assignees: args.assignees as string[] | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  number: issue.number,
                  title: issue.title,
                  state: issue.state,
                  html_url: issue.html_url,
                  updated_at: issue.updated_at,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_add_issue_comment",
      description: "Add a comment to an issue.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          issueNumber: {
            type: "number",
            description: "Issue number. Required.",
          },
          body: {
            type: "string",
            description: "Comment body. Required.",
          },
        },
        required: ["owner", "repo", "issueNumber", "body"],
      },
      handler: async (args: Record<string, unknown>) => {
        const comment = await client.addIssueComment(
          args.owner as string,
          args.repo as string,
          args.issueNumber as number,
          args.body as string
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: comment.id,
                  html_url: comment.html_url,
                  created_at: comment.created_at,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },

    // ==========================================================================
    // Pull Requests (6)
    // ==========================================================================
    {
      name: "github_list_prs",
      description: "List pull requests in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "PR state. Default: open",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const prs = await client.listPRs(
          args.owner as string,
          args.repo as string,
          args.state as "open" | "closed" | "all" | undefined,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                prs.map((p) => ({
                  number: p.number,
                  title: p.title,
                  state: p.state,
                  user: p.user.login,
                  head: p.head.ref,
                  base: p.base.ref,
                  merged: p.merged,
                  created_at: p.created_at,
                  html_url: p.html_url,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_get_pr",
      description: "Get details of a specific pull request.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          prNumber: {
            type: "number",
            description: "PR number. Required.",
          },
        },
        required: ["owner", "repo", "prNumber"],
      },
      handler: async (args: Record<string, unknown>) => {
        const pr = await client.getPR(
          args.owner as string,
          args.repo as string,
          args.prNumber as number
        );
        return {
          content: [{ type: "text", text: JSON.stringify(pr, null, 2) }],
        };
      },
    },
    {
      name: "github_create_pr",
      description: "Create a new pull request.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          title: {
            type: "string",
            description: "PR title. Required.",
          },
          head: {
            type: "string",
            description: "Branch with changes. Required.",
          },
          base: {
            type: "string",
            description: "Branch to merge into. Required.",
          },
          body: {
            type: "string",
            description: "PR description.",
          },
          draft: {
            type: "boolean",
            description: "Create as draft PR.",
          },
        },
        required: ["owner", "repo", "title", "head", "base"],
      },
      handler: async (args: Record<string, unknown>) => {
        const pr = await client.createPR({
          owner: args.owner as string,
          repo: args.repo as string,
          title: args.title as string,
          head: args.head as string,
          base: args.base as string,
          body: args.body as string | undefined,
          draft: args.draft as boolean | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  number: pr.number,
                  title: pr.title,
                  html_url: pr.html_url,
                  created_at: pr.created_at,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_list_pr_commits",
      description: "List commits in a pull request.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          prNumber: {
            type: "number",
            description: "PR number. Required.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
        },
        required: ["owner", "repo", "prNumber"],
      },
      handler: async (args: Record<string, unknown>) => {
        const commits = await client.listPRCommits(
          args.owner as string,
          args.repo as string,
          args.prNumber as number,
          args.perPage as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                commits.map((c) => ({
                  sha: c.sha.substring(0, 7),
                  message: c.commit.message.split("\n")[0],
                  author: c.commit.author.name,
                  date: c.commit.author.date,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_list_pr_files",
      description: "List files changed in a pull request.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          prNumber: {
            type: "number",
            description: "PR number. Required.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
        },
        required: ["owner", "repo", "prNumber"],
      },
      handler: async (args: Record<string, unknown>) => {
        const files = await client.listPRFiles(
          args.owner as string,
          args.repo as string,
          args.prNumber as number,
          args.perPage as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                files.map((f) => ({
                  filename: f.filename,
                  status: f.status,
                  additions: f.additions,
                  deletions: f.deletions,
                  changes: f.changes,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_list_pr_reviews",
      description: "List reviews on a pull request.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          prNumber: {
            type: "number",
            description: "PR number. Required.",
          },
        },
        required: ["owner", "repo", "prNumber"],
      },
      handler: async (args: Record<string, unknown>) => {
        const reviews = await client.listPRReviews(
          args.owner as string,
          args.repo as string,
          args.prNumber as number
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                reviews.map((r) => ({
                  id: r.id,
                  user: r.user.login,
                  state: r.state,
                  submitted_at: r.submitted_at,
                })),
                null,
                2
              ),
            },
          ],
        };
      },
    },

    // ==========================================================================
    // Search (3)
    // ==========================================================================
    {
      name: "github_search_repos",
      description: "Search for repositories.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query. Required.",
          },
          sort: {
            type: "string",
            enum: ["stars", "forks", "help-wanted-issues", "updated"],
            description: "Sort by.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
        required: ["query"],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await client.searchRepos(
          args.query as string,
          args.sort as "stars" | "forks" | "help-wanted-issues" | "updated" | undefined,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total_count: result.total_count,
                  items: result.items.map((r) => ({
                    full_name: r.full_name,
                    description: r.description,
                    stargazers_count: r.stargazers_count,
                    language: r.language,
                    html_url: r.html_url,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_search_code",
      description: "Search for code across repositories.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g., 'addClass in:file language:js repo:jquery/jquery'). Required.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
        required: ["query"],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await client.searchCode(
          args.query as string,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total_count: result.total_count,
                  items: result.items.map((i) => ({
                    name: i.name,
                    path: i.path,
                    repository: i.repository.full_name,
                    html_url: i.html_url,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_search_issues",
      description: "Search for issues and pull requests.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g., 'repo:owner/repo is:open is:issue'). Required.",
          },
          sort: {
            type: "string",
            enum: ["comments", "reactions", "created", "updated"],
            description: "Sort by.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
          page: {
            type: "number",
            description: "Page number. Default: 1",
          },
        },
        required: ["query"],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await client.searchIssues(
          args.query as string,
          args.sort as "comments" | "reactions" | "created" | "updated" | undefined,
          args.perPage as number | undefined,
          args.page as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total_count: result.total_count,
                  items: result.items.map((i) => ({
                    number: i.number,
                    title: i.title,
                    state: i.state,
                    user: i.user.login,
                    created_at: i.created_at,
                    html_url: i.html_url,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },

    // ==========================================================================
    // Actions (3)
    // ==========================================================================
    {
      name: "github_list_workflows",
      description: "List workflows in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await client.listWorkflows(
          args.owner as string,
          args.repo as string,
          args.perPage as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total_count: result.total_count,
                  workflows: result.workflows.map((w) => ({
                    id: w.id,
                    name: w.name,
                    path: w.path,
                    state: w.state,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_list_workflow_runs",
      description: "List workflow runs in a repository.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          workflowId: {
            type: ["number", "string"],
            description: "Workflow ID or file name to filter by.",
          },
          status: {
            type: "string",
            enum: ["queued", "in_progress", "completed"],
            description: "Filter by status.",
          },
          perPage: {
            type: "number",
            description: "Results per page. Default: 30",
          },
        },
        required: ["owner", "repo"],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await client.listWorkflowRuns(
          args.owner as string,
          args.repo as string,
          args.workflowId as number | string | undefined,
          args.status as "queued" | "in_progress" | "completed" | undefined,
          args.perPage as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total_count: result.total_count,
                  workflow_runs: result.workflow_runs.map((r) => ({
                    id: r.id,
                    name: r.name,
                    head_branch: r.head_branch,
                    status: r.status,
                    conclusion: r.conclusion,
                    created_at: r.created_at,
                    html_url: r.html_url,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      },
    },
    {
      name: "github_get_workflow_run",
      description: "Get details of a specific workflow run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner. Required.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required.",
          },
          runId: {
            type: "number",
            description: "Workflow run ID. Required.",
          },
        },
        required: ["owner", "repo", "runId"],
      },
      handler: async (args: Record<string, unknown>) => {
        const run = await client.getWorkflowRun(
          args.owner as string,
          args.repo as string,
          args.runId as number
        );
        return {
          content: [{ type: "text", text: JSON.stringify(run, null, 2) }],
        };
      },
    },
  ];
}
