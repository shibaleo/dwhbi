// Jira API Client for MCP
// Uses Basic Auth (email:api_token) stored in Supabase Vault

import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, supabaseKey);
}

interface JiraCredentials {
  email: string;
  api_token: string;
  domain: string;
}

// Cache
let cachedCredentials: JiraCredentials | null = null;

async function getCredentials(): Promise<JiraCredentials> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", { service_name: "jira" });

  if (error || !data) {
    throw new Error("Jira credentials not found in vault");
  }

  const credentials = data as JiraCredentials;

  if (!credentials.email || !credentials.api_token || !credentials.domain) {
    throw new Error("Missing Jira credentials. Configure in Console first.");
  }

  cachedCredentials = credentials;
  return credentials;
}

export interface JiraApiError {
  status: number;
  errorMessages?: string[];
  errors?: Record<string, string>;
}

async function jiraRequest<T>(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
): Promise<T> {
  const credentials = await getCredentials();
  const auth = btoa(`${credentials.email}:${credentials.api_token}`);
  const url = `https://${credentials.domain}/rest/api/3${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as JiraApiError;
    throw {
      status: response.status,
      errorMessages: errorData.errorMessages || [`Jira API error: ${response.status}`],
      errors: errorData.errors,
    } as JiraApiError;
  }

  // DELETE returns 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// =============================================================================
// User / Myself
// =============================================================================

export interface JiraUser {
  accountId: string;
  accountType: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
  active: boolean;
  timeZone?: string;
}

export async function getMyself(): Promise<JiraUser> {
  return jiraRequest<JiraUser>("GET", "/myself");
}

// =============================================================================
// Projects
// =============================================================================

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  simplified?: boolean;
  style?: string;
  avatarUrls?: Record<string, string>;
}

export interface ProjectListResponse {
  values: JiraProject[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}

export async function listProjects(
  startAt = 0,
  maxResults = 50
): Promise<ProjectListResponse> {
  return jiraRequest<ProjectListResponse>(
    "GET",
    `/project/search?startAt=${startAt}&maxResults=${maxResults}`
  );
}

export async function getProject(projectKeyOrId: string): Promise<JiraProject> {
  return jiraRequest<JiraProject>("GET", `/project/${projectKeyOrId}`);
}

// =============================================================================
// Issues
// =============================================================================

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: unknown;
    status?: { name: string; id: string };
    priority?: { name: string; id: string };
    issuetype?: { name: string; id: string };
    assignee?: JiraUser;
    reporter?: JiraUser;
    created?: string;
    updated?: string;
    labels?: string[];
    project?: { key: string; name: string };
    parent?: { key: string; fields?: { summary: string } };
    [key: string]: unknown;
  };
}

export interface IssueSearchResponse {
  issues: JiraIssue[];
  startAt: number;
  maxResults: number;
  total: number;
}

export async function searchIssues(
  jql: string,
  startAt = 0,
  maxResults = 50,
  fields?: string[]
): Promise<IssueSearchResponse> {
  const params = new URLSearchParams({
    jql,
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });
  if (fields && fields.length > 0) {
    params.set("fields", fields.join(","));
  }
  return jiraRequest<IssueSearchResponse>("GET", `/search/jql?${params}`);
}

export async function getIssue(
  issueKeyOrId: string,
  fields?: string[]
): Promise<JiraIssue> {
  const params = new URLSearchParams();
  if (fields && fields.length > 0) {
    params.set("fields", fields.join(","));
  }
  const query = params.toString() ? `?${params}` : "";
  return jiraRequest<JiraIssue>("GET", `/issue/${issueKeyOrId}${query}`);
}

export interface CreateIssueParams {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  assigneeAccountId?: string;
  priority?: string;
  labels?: string[];
  parentKey?: string;
  customFields?: Record<string, unknown>;
}

export async function createIssue(params: CreateIssueParams): Promise<JiraIssue> {
  const fields: Record<string, unknown> = {
    project: { key: params.projectKey },
    issuetype: { name: params.issueType },
    summary: params.summary,
  };

  if (params.description) {
    // ADF format for description
    fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: params.description }],
        },
      ],
    };
  }

  if (params.assigneeAccountId) {
    fields.assignee = { accountId: params.assigneeAccountId };
  }

  if (params.priority) {
    fields.priority = { name: params.priority };
  }

  if (params.labels) {
    fields.labels = params.labels;
  }

  if (params.parentKey) {
    fields.parent = { key: params.parentKey };
  }

  if (params.customFields) {
    Object.assign(fields, params.customFields);
  }

  return jiraRequest<JiraIssue>("POST", "/issue", { fields });
}

export interface UpdateIssueParams {
  issueKeyOrId: string;
  summary?: string;
  description?: string;
  assigneeAccountId?: string;
  priority?: string;
  labels?: string[];
  customFields?: Record<string, unknown>;
}

export async function updateIssue(params: UpdateIssueParams): Promise<void> {
  const fields: Record<string, unknown> = {};

  if (params.summary !== undefined) {
    fields.summary = params.summary;
  }

  if (params.description !== undefined) {
    fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: params.description }],
        },
      ],
    };
  }

  if (params.assigneeAccountId !== undefined) {
    fields.assignee = { accountId: params.assigneeAccountId };
  }

  if (params.priority !== undefined) {
    fields.priority = { name: params.priority };
  }

  if (params.labels !== undefined) {
    fields.labels = params.labels;
  }

  if (params.customFields) {
    Object.assign(fields, params.customFields);
  }

  await jiraRequest<void>("PUT", `/issue/${params.issueKeyOrId}`, { fields });
}

// =============================================================================
// Transitions
// =============================================================================

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; id: string };
}

export interface TransitionsResponse {
  transitions: JiraTransition[];
}

export async function getTransitions(
  issueKeyOrId: string
): Promise<TransitionsResponse> {
  return jiraRequest<TransitionsResponse>(
    "GET",
    `/issue/${issueKeyOrId}/transitions`
  );
}

export async function transitionIssue(
  issueKeyOrId: string,
  transitionId: string,
  comment?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    transition: { id: transitionId },
  };

  if (comment) {
    body.update = {
      comment: [
        {
          add: {
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: comment }],
                },
              ],
            },
          },
        },
      ],
    };
  }

  await jiraRequest<void>("POST", `/issue/${issueKeyOrId}/transitions`, body);
}

// =============================================================================
// Comments
// =============================================================================

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: unknown;
  created: string;
  updated: string;
}

export interface CommentsResponse {
  comments: JiraComment[];
  startAt: number;
  maxResults: number;
  total: number;
}

export async function getComments(
  issueKeyOrId: string,
  startAt = 0,
  maxResults = 50
): Promise<CommentsResponse> {
  return jiraRequest<CommentsResponse>(
    "GET",
    `/issue/${issueKeyOrId}/comment?startAt=${startAt}&maxResults=${maxResults}`
  );
}

export async function addComment(
  issueKeyOrId: string,
  body: string
): Promise<JiraComment> {
  return jiraRequest<JiraComment>("POST", `/issue/${issueKeyOrId}/comment`, {
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: body }],
        },
      ],
    },
  });
}
