/**
 * Credentials vault using Supabase Vault
 *
 * Manages OAuth credentials stored in vault.secrets.
 * Uses direct DB connection for vault functions.
 *
 * Storage format in vault.secrets.secret (JSON string):
 * {
 *   "client_id": "...",
 *   "access_token": "...",
 *   "_auth_type": "oauth2",
 *   "_expires_at": "2024-01-01T00:00:00+00:00"
 * }
 */

import pg from "pg";
import { config } from "dotenv";

// Load .env for local development
config();

const { Client } = pg;

// Types
export interface CredentialsResult {
  credentials: Record<string, unknown>;
  expiresAt: Date | null;
}

/**
 * Get direct database connection
 */
function getDbConnection(): pg.Client {
  const databaseUrl = process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DIRECT_DATABASE_URL environment variable is required");
  }
  return new Client({ connectionString: databaseUrl });
}

/**
 * Get credentials from vault.secrets
 *
 * @param service - Service identifier (e.g., "toggl_track", "google_calendar")
 * @returns Decrypted credentials and expiry date
 * @throws Error if credentials not found
 */
export async function getCredentials(
  service: string
): Promise<CredentialsResult> {
  const client = getDbConnection();

  try {
    await client.connect();

    const result = await client.query(
      "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1",
      [service]
    );

    if (result.rows.length === 0 || !result.rows[0].decrypted_secret) {
      throw new Error(`Credentials not found for service: ${service}`);
    }

    const decrypted = result.rows[0].decrypted_secret;
    const data =
      typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;

    // Extract metadata
    const expiresAtStr = data._expires_at;
    delete data._expires_at;
    delete data._auth_type;

    // Parse expires_at
    let expiresAt: Date | null = null;
    if (expiresAtStr) {
      expiresAt = new Date(expiresAtStr.replace("Z", "+00:00"));
    }

    return {
      credentials: data,
      expiresAt,
    };
  } finally {
    await client.end();
  }
}

/**
 * Update credentials in vault.secrets (partial update)
 *
 * @param service - Service identifier
 * @param updates - Fields to update (merged with existing)
 * @param expiresAt - New expiry date (null to keep existing)
 */
export async function updateCredentials(
  service: string,
  updates: Record<string, unknown>,
  expiresAt: Date | null = null
): Promise<void> {
  const client = getDbConnection();

  try {
    await client.connect();

    // Get existing credentials
    const result = await client.query(
      "SELECT id, decrypted_secret FROM vault.decrypted_secrets WHERE name = $1",
      [service]
    );

    if (result.rows.length === 0) {
      throw new Error(`Credentials not found for service: ${service}`);
    }

    const secretId = result.rows[0].id;
    const decrypted = result.rows[0].decrypted_secret;
    const currentData =
      typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;

    // Preserve metadata
    const authType = currentData._auth_type || "oauth2";
    const currentExpiresAt = currentData._expires_at;

    // Merge non-metadata fields
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(currentData)) {
      if (!key.startsWith("_")) {
        merged[key] = value;
      }
    }
    Object.assign(merged, updates);

    // Add metadata back
    merged._auth_type = authType;
    merged._expires_at = expiresAt ? expiresAt.toISOString() : currentExpiresAt;

    // Update
    const secretJson = JSON.stringify(merged);
    await client.query(
      "SELECT vault.update_secret($1, $2, $3, $4)",
      [secretId, secretJson, service, `${service} credentials`]
    );
  } finally {
    await client.end();
  }
}

/**
 * Save new credentials to vault.secrets
 *
 * @param service - Service identifier
 * @param credentials - Credentials to save
 * @param authType - Authentication type ("oauth2", "oauth1", "api_key", etc.)
 * @param expiresAt - Expiry date (null for no expiry)
 * @param description - Optional description
 */
export async function saveCredentials(
  service: string,
  credentials: Record<string, unknown>,
  authType: string = "oauth2",
  expiresAt: Date | null = null,
  description?: string
): Promise<void> {
  const vaultData = {
    ...credentials,
    _auth_type: authType,
    _expires_at: expiresAt ? expiresAt.toISOString() : null,
  };
  const secretJson = JSON.stringify(vaultData);
  const desc = description || `${service} credentials`;

  const client = getDbConnection();

  try {
    await client.connect();

    // Check existing
    const existing = await client.query(
      "SELECT id FROM vault.secrets WHERE name = $1",
      [service]
    );

    if (existing.rows.length > 0) {
      await client.query(
        "SELECT vault.update_secret($1, $2, $3, $4)",
        [existing.rows[0].id, secretJson, service, desc]
      );
    } else {
      await client.query(
        "SELECT vault.create_secret($1, $2, $3)",
        [secretJson, service, desc]
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Delete credentials
 *
 * @param service - Service identifier
 */
export async function deleteCredentials(service: string): Promise<void> {
  const client = getDbConnection();

  try {
    await client.connect();
    await client.query("DELETE FROM vault.secrets WHERE name = $1", [service]);
  } finally {
    await client.end();
  }
}

/**
 * List all registered services
 *
 * @returns List of service info (without credentials)
 */
export async function listServices(): Promise<
  Array<{
    service: string;
    authType: string;
    expiresAt: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
  const client = getDbConnection();

  try {
    await client.connect();

    const result = await client.query(
      "SELECT name, decrypted_secret, created_at, updated_at FROM vault.decrypted_secrets"
    );

    return result.rows.map((row) => {
      const data =
        typeof row.decrypted_secret === "string"
          ? JSON.parse(row.decrypted_secret)
          : row.decrypted_secret || {};

      return {
        service: row.name,
        authType: data._auth_type || "unknown",
        expiresAt: data._expires_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  } finally {
    await client.end();
  }
}
