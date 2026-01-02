import { createClient } from "@/lib/supabase/server";

// サービス一覧
export const SERVICES = [
  "toggl_track",
  "fitbit",
  "zaim",
  "google_calendar",
  "tanita_health_planet",
  "trello",
  "ticktick",
  "airtable",
  "coda",
  "github_contents",
] as const;

export type ServiceName = (typeof SERVICES)[number];

// サービス表示名
export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  toggl_track: "Toggl Track",
  fitbit: "Fitbit",
  zaim: "Zaim",
  google_calendar: "Google Calendar",
  tanita_health_planet: "Tanita Health Planet",
  trello: "Trello",
  ticktick: "TickTick",
  airtable: "Airtable",
  coda: "Coda",
  github_contents: "GitHub Contents",
};

// 認証タイプ
export const SERVICE_AUTH_TYPES: Record<ServiceName, "api_key" | "oauth"> = {
  toggl_track: "api_key",
  fitbit: "oauth",
  zaim: "oauth",
  google_calendar: "oauth",
  tanita_health_planet: "oauth",
  trello: "api_key",
  ticktick: "oauth",
  airtable: "api_key",
  coda: "api_key",
  github_contents: "api_key",
};

export interface ServiceStatus {
  service: ServiceName;
  displayName: string;
  authType: "api_key" | "oauth";
  connected: boolean;
  expiresAt: string | null;
}

/**
 * 全サービスの連携状況を取得
 */
export async function getServicesStatus(): Promise<ServiceStatus[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .schema("console")
    .rpc("get_all_service_secrets", {
      service_names: SERVICES as unknown as string[],
    });

  if (error) {
    console.error("Failed to get services status:", error);
    return SERVICES.map((service) => ({
      service,
      displayName: SERVICE_DISPLAY_NAMES[service],
      authType: SERVICE_AUTH_TYPES[service],
      connected: false,
      expiresAt: null,
    }));
  }

  const connectedServices = new Map<string, { expiresAt: string | null }>();

  for (const row of rows || []) {
    const secret = row.decrypted_secret;
    connectedServices.set(row.name, {
      expiresAt: secret?._expires_at || null,
    });
  }

  return SERVICES.map((service) => ({
    service,
    displayName: SERVICE_DISPLAY_NAMES[service],
    authType: SERVICE_AUTH_TYPES[service],
    connected: connectedServices.has(service),
    expiresAt: connectedServices.get(service)?.expiresAt || null,
  }));
}

/**
 * 特定サービスの認証情報を取得
 */
export async function getServiceCredentials(
  service: ServiceName
): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: service,
    });

  if (error || !data) {
    return null;
  }

  // メタデータを除外して返す
  const { _auth_type, _expires_at, ...credentials } = data;
  return credentials;
}

/**
 * サービスの認証情報を保存
 */
export async function saveServiceCredentials(
  service: ServiceName,
  credentials: Record<string, unknown>,
  expiresAt: string | null = null
): Promise<void> {
  const supabase = await createClient();

  const authType = SERVICE_AUTH_TYPES[service];
  const secretData = {
    ...credentials,
    _auth_type: authType,
    _expires_at: expiresAt,
  };
  const description = `${SERVICE_DISPLAY_NAMES[service]} credentials`;

  const { error } = await supabase
    .schema("console")
    .rpc("upsert_service_secret", {
      service_name: service,
      secret_data: secretData,
      secret_description: description,
    });

  if (error) {
    throw new Error(`Failed to save credentials: ${error.message}`);
  }
}

/**
 * サービスの認証情報を削除
 */
export async function deleteServiceCredentials(
  service: ServiceName
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("delete_service_secret", {
      service_name: service,
    });

  if (error) {
    throw new Error(`Failed to delete credentials: ${error.message}`);
  }
}

/**
 * サービスの認証情報を部分更新
 * 既存の認証情報を保持しつつ、特定フィールドのみ更新/削除
 */
export async function updateServiceCredentials(
  service: ServiceName,
  updates: Record<string, unknown>,
  deletes: string[] = []
): Promise<void> {
  const supabase = await createClient();

  // 既存の認証情報を取得
  const { data: existingSecret, error: getError } = await supabase
    .schema("console")
    .rpc("get_service_secret", { service_name: service });

  if (getError || !existingSecret) {
    throw new Error("Service credentials not found");
  }

  // 削除するフィールドを除去
  const updatedSecret = { ...existingSecret };
  for (const key of deletes) {
    delete updatedSecret[key];
  }

  // 更新するフィールドをマージ
  Object.assign(updatedSecret, updates);

  const description = `${SERVICE_DISPLAY_NAMES[service]} credentials`;

  const { error } = await supabase
    .schema("console")
    .rpc("upsert_service_secret", {
      service_name: service,
      secret_data: updatedSecret,
      secret_description: description,
    });

  if (error) {
    throw new Error(`Failed to update credentials: ${error.message}`);
  }
}

// ============================================
// GitHub PAT 管理
// ============================================

export interface GitHubConfig {
  pat: string;
  owner: string;
  repo: string;
  expiresAt?: string | null;
}

const GITHUB_SECRET_NAME = "github";
const GITHUB_CONTENTS_SECRET_NAME = "github_contents";

/**
 * GitHub設定を取得
 */
export async function getGitHubConfig(): Promise<GitHubConfig | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: GITHUB_SECRET_NAME,
    });

  if (error || !data) {
    return null;
  }

  return {
    pat: data.pat || "",
    owner: data.owner || "",
    repo: data.repo || "",
    expiresAt: data.expiresAt || null,
  };
}

/**
 * GitHub設定を保存
 */
export async function saveGitHubConfig(config: GitHubConfig): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("upsert_service_secret", {
      service_name: GITHUB_SECRET_NAME,
      secret_data: config,
      secret_description: "GitHub PAT for Actions dispatch",
    });

  if (error) {
    throw new Error(`Failed to save GitHub config: ${error.message}`);
  }
}

/**
 * GitHub設定を削除
 */
export async function deleteGitHubConfig(): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("delete_service_secret", {
      service_name: GITHUB_SECRET_NAME,
    });

  if (error) {
    throw new Error(`Failed to delete GitHub config: ${error.message}`);
  }
}

/**
 * GitHub設定が存在するかチェック
 */
export async function hasGitHubConfig(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: GITHUB_SECRET_NAME,
    });

  return !error && data !== null;
}

// ============================================
// GitHub Contents API Token 管理
// ============================================

export interface GitHubContentsConfig {
  token: string;
  repositories: string; // "owner/repo/path" per line
  expiresAt?: string | null;
}

/**
 * Parse repositories string into array of {owner, repo, path}
 */
export function parseRepositories(repositories: string): Array<{ owner: string; repo: string; path: string }> {
  return repositories
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split("/");
      if (parts.length < 3) {
        throw new Error(`Invalid repository format: ${line}. Expected owner/repo/path`);
      }
      return {
        owner: parts[0],
        repo: parts[1],
        path: parts.slice(2).join("/"),
      };
    });
}

/**
 * GitHub Contents設定を取得
 */
export async function getGitHubContentsConfig(): Promise<GitHubContentsConfig | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: GITHUB_CONTENTS_SECRET_NAME,
    });

  if (error || !data) {
    return null;
  }

  return {
    token: data.token || "",
    repositories: data.repositories || "",
    expiresAt: data.expiresAt || null,
  };
}

/**
 * GitHub Contents設定を保存
 */
export async function saveGitHubContentsConfig(config: GitHubContentsConfig): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("upsert_service_secret", {
      service_name: GITHUB_CONTENTS_SECRET_NAME,
      secret_data: config,
      secret_description: "GitHub Contents API token for RAG Embedding Connector",
    });

  if (error) {
    throw new Error(`Failed to save GitHub Contents config: ${error.message}`);
  }
}

/**
 * GitHub Contents設定を削除
 */
export async function deleteGitHubContentsConfig(): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("delete_service_secret", {
      service_name: GITHUB_CONTENTS_SECRET_NAME,
    });

  if (error) {
    throw new Error(`Failed to delete GitHub Contents config: ${error.message}`);
  }
}

/**
 * GitHub Contents設定が存在するかチェック
 */
export async function hasGitHubContentsConfig(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: GITHUB_CONTENTS_SECRET_NAME,
    });

  return !error && data !== null;
}

// ============================================
// Voyage AI API Key 管理
// ============================================

const VOYAGE_SECRET_NAME = "voyage";

export interface VoyageConfig {
  api_key: string;
}

/**
 * Voyage AI設定を取得
 */
export async function getVoyageConfig(): Promise<VoyageConfig | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: VOYAGE_SECRET_NAME,
    });

  if (error || !data) {
    return null;
  }

  return {
    api_key: data.api_key || "",
  };
}

/**
 * Voyage AI設定を保存
 */
export async function saveVoyageConfig(config: VoyageConfig): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("upsert_service_secret", {
      service_name: VOYAGE_SECRET_NAME,
      secret_data: { ...config, _auth_type: "api_key" },
      secret_description: "Voyage AI API Key for embeddings",
    });

  if (error) {
    throw new Error(`Failed to save Voyage config: ${error.message}`);
  }
}

/**
 * Voyage AI設定を削除
 */
export async function deleteVoyageConfig(): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .schema("console")
    .rpc("delete_service_secret", {
      service_name: VOYAGE_SECRET_NAME,
    });

  if (error) {
    throw new Error(`Failed to delete Voyage config: ${error.message}`);
  }
}

/**
 * Voyage AI設定が存在するかチェック
 */
export async function hasVoyageConfig(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", {
      service_name: VOYAGE_SECRET_NAME,
    });

  return !error && data !== null;
}
