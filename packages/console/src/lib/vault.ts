import { createClient } from "@/lib/supabase/server";

// サービス一覧
export const SERVICES = [
  "toggl_track",
  "fitbit",
  "zaim",
  "google_calendar",
  "tanita",
  "trello",
  "ticktick",
  "airtable",
  "coda",
] as const;

export type ServiceName = (typeof SERVICES)[number];

// サービス表示名
export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  toggl_track: "Toggl Track",
  fitbit: "Fitbit",
  zaim: "Zaim",
  google_calendar: "Google Calendar",
  tanita: "Tanita",
  trello: "Trello",
  ticktick: "TickTick",
  airtable: "Airtable",
  coda: "Coda",
};

// 認証タイプ
export const SERVICE_AUTH_TYPES: Record<ServiceName, "api_key" | "oauth"> = {
  toggl_track: "api_key",
  fitbit: "oauth",
  zaim: "oauth",
  google_calendar: "oauth",
  tanita: "oauth",
  trello: "api_key",
  ticktick: "oauth",
  airtable: "api_key",
  coda: "api_key",
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
