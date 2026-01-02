// supabase/functions/personal-context/supabase/api.ts
// Supabase Management API クライアント

const MANAGEMENT_API_URL = "https://api.supabase.com";

interface ManagementApiOptions {
  accessToken: string;
  projectRef: string;
}

// Types
export interface Migration {
  version: string;
  name?: string;
  statements?: string[];
}

export interface Organization {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  region: string;
  created_at: string;
}

export interface ApiKey {
  api_key: string;
  name: string;
}

export interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StorageBucket {
  id: string;
  name: string;
  public: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageConfig {
  fileSizeLimit: number;
  features: {
    imageTransformation: { enabled: boolean };
    s3Protocol: { enabled: boolean };
  };
}

export interface LogEntry {
  timestamp: string;
  event_message: string;
  metadata?: Record<string, unknown>;
}

type LogService =
  | "api"
  | "postgres"
  | "edge-function"
  | "auth"
  | "storage"
  | "realtime";

export function createManagementApi(options: ManagementApiOptions) {
  const { accessToken, projectRef } = options;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${MANAGEMENT_API_URL}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as { message?: string }).message ||
          `API error: ${response.status}`
      );
    }

    // 204 No Content の場合は空オブジェクトを返す
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  return {
    // Database Operations
    async executeSql(query: string, readOnly = true) {
      return request<unknown[]>(
        "POST",
        `/v1/projects/${projectRef}/database/query`,
        {
          query,
          read_only: readOnly,
        }
      );
    },

    async listMigrations() {
      return request<Migration[]>(
        "GET",
        `/v1/projects/${projectRef}/database/migrations`
      );
    },

    async applyMigration(name: string, query: string) {
      return request<void>(
        "POST",
        `/v1/projects/${projectRef}/database/migrations`,
        {
          name,
          query,
        }
      );
    },

    // Account Operations
    async listOrganizations() {
      return request<Organization[]>("GET", "/v1/organizations");
    },

    async listProjects() {
      return request<Project[]>("GET", "/v1/projects");
    },

    async getProject(ref?: string) {
      return request<Project>("GET", `/v1/projects/${ref || projectRef}`);
    },

    // Debugging Operations
    async getLogs(
      service: LogService,
      startTime?: string,
      endTime?: string
    ): Promise<LogEntry[]> {
      const sql = getLogQuery(service);
      const params = new URLSearchParams({ sql });
      if (startTime) params.set("iso_timestamp_start", startTime);
      if (endTime) params.set("iso_timestamp_end", endTime);

      const result = await request<{ result: LogEntry[] }>(
        "GET",
        `/v1/projects/${projectRef}/analytics/endpoints/logs.all?${params}`
      );
      return result.result || [];
    },

    async getSecurityAdvisors() {
      return request<unknown>(
        "GET",
        `/v1/projects/${projectRef}/advisors/security`
      );
    },

    async getPerformanceAdvisors() {
      return request<unknown>(
        "GET",
        `/v1/projects/${projectRef}/advisors/performance`
      );
    },

    // Development Operations
    getProjectUrl() {
      return `https://${projectRef}.supabase.co`;
    },

    async getApiKeys() {
      return request<ApiKey[]>(
        "GET",
        `/v1/projects/${projectRef}/api-keys?reveal=false`
      );
    },

    async generateTypescriptTypes() {
      return request<{ types: string }>(
        "GET",
        `/v1/projects/${projectRef}/types/typescript`
      );
    },

    // Edge Functions
    async listEdgeFunctions() {
      return request<EdgeFunction[]>(
        "GET",
        `/v1/projects/${projectRef}/functions`
      );
    },

    async getEdgeFunction(slug: string) {
      return request<EdgeFunction>(
        "GET",
        `/v1/projects/${projectRef}/functions/${slug}`
      );
    },

    // Storage
    async listStorageBuckets() {
      return request<StorageBucket[]>(
        "GET",
        `/v1/projects/${projectRef}/storage/buckets`
      );
    },

    async getStorageConfig() {
      return request<StorageConfig>(
        "GET",
        `/v1/projects/${projectRef}/config/storage`
      );
    },
  };
}

function getLogQuery(service: LogService): string {
  const baseFields = "timestamp, event_message, metadata";

  const queries: Record<LogService, string> = {
    api: `select ${baseFields} from edge_logs where timestamp > now() - interval '1 hour' order by timestamp desc limit 100`,
    postgres: `select ${baseFields} from postgres_logs where timestamp > now() - interval '1 hour' order by timestamp desc limit 100`,
    "edge-function": `select ${baseFields} from edge_logs where timestamp > now() - interval '1 hour' order by timestamp desc limit 100`,
    auth: `select ${baseFields} from auth_logs where timestamp > now() - interval '1 hour' order by timestamp desc limit 100`,
    storage: `select ${baseFields} from storage_logs where timestamp > now() - interval '1 hour' order by timestamp desc limit 100`,
    realtime: `select ${baseFields} from realtime_logs where timestamp > now() - interval '1 hour' order by timestamp desc limit 100`,
  };

  return queries[service] || queries.api;
}

export type ManagementApi = ReturnType<typeof createManagementApi>;
