import postgres from "postgres";

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
};

export interface ServiceStatus {
  service: ServiceName;
  displayName: string;
  authType: "api_key" | "oauth";
  connected: boolean;
  expiresAt: string | null;
}

function getDbConnection() {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_DATABASE_URL is not set");
  }
  return postgres(connectionString);
}

/**
 * 全サービスの連携状況を取得
 */
export async function getServicesStatus(): Promise<ServiceStatus[]> {
  const sql = getDbConnection();

  try {
    // Vault から全サービスの情報を取得
    const rows = await sql`
      SELECT name, decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = ANY(${SERVICES as unknown as string[]})
    `;

    const connectedServices = new Map<string, { expiresAt: string | null }>();

    for (const row of rows) {
      const secret = typeof row.decrypted_secret === "string"
        ? JSON.parse(row.decrypted_secret)
        : row.decrypted_secret;

      connectedServices.set(row.name, {
        expiresAt: secret._expires_at || null,
      });
    }

    return SERVICES.map((service) => ({
      service,
      displayName: SERVICE_DISPLAY_NAMES[service],
      authType: SERVICE_AUTH_TYPES[service],
      connected: connectedServices.has(service),
      expiresAt: connectedServices.get(service)?.expiresAt || null,
    }));
  } finally {
    await sql.end();
  }
}

/**
 * 特定サービスの認証情報を取得
 */
export async function getServiceCredentials(
  service: ServiceName
): Promise<Record<string, unknown> | null> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = ${service}
    `;

    if (rows.length === 0) {
      return null;
    }

    const secret = typeof rows[0].decrypted_secret === "string"
      ? JSON.parse(rows[0].decrypted_secret)
      : rows[0].decrypted_secret;

    // メタデータを除外して返す
    const { _auth_type, _expires_at, ...credentials } = secret;
    return credentials;
  } finally {
    await sql.end();
  }
}

/**
 * サービスの認証情報を保存
 */
export async function saveServiceCredentials(
  service: ServiceName,
  credentials: Record<string, unknown>,
  expiresAt: string | null = null
): Promise<void> {
  const sql = getDbConnection();

  try {
    const authType = SERVICE_AUTH_TYPES[service];
    const secretData = {
      ...credentials,
      _auth_type: authType,
      _expires_at: expiresAt,
    };
    const secretJson = JSON.stringify(secretData);
    const description = `${SERVICE_DISPLAY_NAMES[service]} credentials`;

    // 既存のシークレットがあるか確認
    const existing = await sql`
      SELECT id FROM vault.secrets WHERE name = ${service}
    `;

    if (existing.length > 0) {
      // 更新
      await sql`
        SELECT vault.update_secret(
          ${existing[0].id}::uuid,
          ${secretJson}::text,
          ${service}::text,
          ${description}::text
        )
      `;
    } else {
      // 新規作成
      await sql`
        SELECT vault.create_secret(
          ${secretJson}::text,
          ${service}::text,
          ${description}::text
        )
      `;
    }
  } finally {
    await sql.end();
  }
}

/**
 * サービスの認証情報を削除
 */
export async function deleteServiceCredentials(
  service: ServiceName
): Promise<void> {
  const sql = getDbConnection();

  try {
    await sql`
      DELETE FROM vault.secrets WHERE name = ${service}
    `;
  } finally {
    await sql.end();
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
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = ${GITHUB_SECRET_NAME}
    `;

    if (rows.length === 0) {
      return null;
    }

    const secret = typeof rows[0].decrypted_secret === "string"
      ? JSON.parse(rows[0].decrypted_secret)
      : rows[0].decrypted_secret;

    return {
      pat: secret.pat || "",
      owner: secret.owner || "",
      repo: secret.repo || "",
      expiresAt: secret.expiresAt || null,
    };
  } finally {
    await sql.end();
  }
}

/**
 * GitHub設定を保存
 */
export async function saveGitHubConfig(config: GitHubConfig): Promise<void> {
  const sql = getDbConnection();

  try {
    const secretJson = JSON.stringify(config);
    const description = "GitHub PAT for Actions dispatch";

    // 既存のシークレットがあるか確認
    const existing = await sql`
      SELECT id FROM vault.secrets WHERE name = ${GITHUB_SECRET_NAME}
    `;

    if (existing.length > 0) {
      // 更新
      await sql`
        SELECT vault.update_secret(
          ${existing[0].id}::uuid,
          ${secretJson}::text,
          ${GITHUB_SECRET_NAME}::text,
          ${description}::text
        )
      `;
    } else {
      // 新規作成
      await sql`
        SELECT vault.create_secret(
          ${secretJson}::text,
          ${GITHUB_SECRET_NAME}::text,
          ${description}::text
        )
      `;
    }
  } finally {
    await sql.end();
  }
}

/**
 * GitHub設定を削除
 */
export async function deleteGitHubConfig(): Promise<void> {
  const sql = getDbConnection();

  try {
    await sql`
      DELETE FROM vault.secrets WHERE name = ${GITHUB_SECRET_NAME}
    `;
  } finally {
    await sql.end();
  }
}

/**
 * GitHub設定が存在するかチェック
 */
export async function hasGitHubConfig(): Promise<boolean> {
  const sql = getDbConnection();

  try {
    const rows = await sql`
      SELECT 1 FROM vault.secrets WHERE name = ${GITHUB_SECRET_NAME}
    `;
    return rows.length > 0;
  } finally {
    await sql.end();
  }
}
