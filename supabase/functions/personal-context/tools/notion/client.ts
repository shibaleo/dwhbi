// Notion API Client
// API Version: 2022-06-28 (stable, widely compatible)

import { createClient } from "@supabase/supabase-js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, supabaseKey);
}

let cachedToken: string | null = null;

async function getNotionToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", { service_name: "notion" });

  if (error || !data?.api_token) {
    throw new Error("Notion API token not found in vault");
  }

  cachedToken = data.api_token;
  return cachedToken;
}

export interface NotionApiError {
  status: number;
  code: string;
  message: string;
}

export async function notionRequest<T>(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
): Promise<T> {
  const token = await getNotionToken();
  const url = `${NOTION_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw {
      status: response.status,
      code: errorData.code || "unknown_error",
      message: errorData.message || `Notion API error: ${response.status}`,
    } as NotionApiError;
  }

  return response.json();
}

// =============================================================================
// Search
// =============================================================================
export interface SearchParams {
  query?: string;
  filter?: { property: "object"; value: "page" | "database" };
  sort?: { direction: "ascending" | "descending"; timestamp: "last_edited_time" };
  start_cursor?: string;
  page_size?: number;
}

export async function search(params: SearchParams) {
  return notionRequest<NotionListResponse>("POST", "/search", params);
}

// =============================================================================
// Pages
// =============================================================================
export async function retrievePage(pageId: string) {
  return notionRequest<NotionPage>("GET", `/pages/${pageId}`);
}

export async function createPage(params: {
  parent: { page_id?: string; database_id?: string };
  properties: Record<string, unknown>;
  children?: NotionBlock[];
}) {
  return notionRequest<NotionPage>("POST", "/pages", params);
}

export async function updatePage(pageId: string, properties: Record<string, unknown>) {
  return notionRequest<NotionPage>("PATCH", `/pages/${pageId}`, { properties });
}

// =============================================================================
// Databases
// =============================================================================
export async function queryDatabase(
  databaseId: string,
  params?: {
    filter?: Record<string, unknown>;
    sorts?: Array<{ property?: string; timestamp?: string; direction: "ascending" | "descending" }>;
    start_cursor?: string;
    page_size?: number;
  }
) {
  return notionRequest<NotionListResponse>("POST", `/databases/${databaseId}/query`, params || {});
}

export async function retrieveDatabase(databaseId: string) {
  return notionRequest<NotionDatabase>("GET", `/databases/${databaseId}`);
}

// =============================================================================
// Blocks
// =============================================================================
export async function retrieveBlockChildren(
  blockId: string,
  params?: { start_cursor?: string; page_size?: number }
) {
  const query = new URLSearchParams();
  if (params?.start_cursor) query.set("start_cursor", params.start_cursor);
  if (params?.page_size) query.set("page_size", params.page_size.toString());
  const queryStr = query.toString();
  return notionRequest<NotionListResponse>(
    "GET",
    `/blocks/${blockId}/children${queryStr ? `?${queryStr}` : ""}`
  );
}

export async function appendBlockChildren(blockId: string, children: NotionBlock[]) {
  return notionRequest<NotionListResponse>("PATCH", `/blocks/${blockId}/children`, { children });
}

export async function deleteBlock(blockId: string) {
  return notionRequest<NotionBlock>("DELETE", `/blocks/${blockId}`);
}

// =============================================================================
// Comments
// =============================================================================
export async function listComments(blockId: string, params?: { start_cursor?: string; page_size?: number }) {
  const query = new URLSearchParams({ block_id: blockId });
  if (params?.start_cursor) query.set("start_cursor", params.start_cursor);
  if (params?.page_size) query.set("page_size", params.page_size.toString());
  return notionRequest<NotionListResponse>("GET", `/comments?${query}`);
}

export async function createComment(params: {
  parent: { page_id: string };
  rich_text: Array<{ text: { content: string } }>;
}) {
  return notionRequest<NotionComment>("POST", "/comments", params);
}

// =============================================================================
// Users
// =============================================================================
export async function listUsers(params?: { start_cursor?: string; page_size?: number }) {
  const query = new URLSearchParams();
  if (params?.start_cursor) query.set("start_cursor", params.start_cursor);
  if (params?.page_size) query.set("page_size", params.page_size.toString());
  const queryStr = query.toString();
  return notionRequest<NotionListResponse>("GET", `/users${queryStr ? `?${queryStr}` : ""}`);
}

export async function retrieveUser(userId: string) {
  return notionRequest<NotionUser>("GET", `/users/${userId}`);
}

export async function retrieveBotUser() {
  return notionRequest<NotionUser>("GET", "/users/me");
}

// =============================================================================
// Types
// =============================================================================
export interface NotionListResponse {
  object: "list";
  results: unknown[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface NotionPage {
  object: "page";
  id: string;
  created_time: string;
  last_edited_time: string;
  parent: { type: string; [key: string]: unknown };
  properties: Record<string, unknown>;
  url: string;
}

export interface NotionDatabase {
  object: "database";
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, unknown>;
}

export interface NotionBlock {
  object: "block";
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface NotionComment {
  object: "comment";
  id: string;
  parent: { type: string; [key: string]: unknown };
  rich_text: Array<{ plain_text: string }>;
}

export interface NotionUser {
  object: "user";
  id: string;
  name: string;
  type: "person" | "bot";
}
