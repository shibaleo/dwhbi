/**
 * Fitbit OAuth2.0 認証管理
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read auth.ts              # 有効性確認（必要ならリフレッシュ）
 *   deno run --allow-env --allow-net --allow-read auth.ts --refresh    # 強制リフレッシュ
 */

import "jsr:@std/dotenv/load";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import * as log from "../../utils/log.ts";
import type { AuthOptions, DbToken, TokenResponse } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const OAUTH_TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const DEFAULT_THRESHOLD_MINUTES = 60; // 1時間前にリフレッシュ
const SCHEMA = "fitbit";
const TABLE = "tokens";

// =============================================================================
// Supabase Client
// =============================================================================

function createSupabaseClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(url, key);
}

// =============================================================================
// Token Validation
// =============================================================================

/**
 * トークンが期限切れ間近かどうかを判定
 * @param expiresAt 有効期限
 * @param thresholdMinutes 閾値（分）
 */
export function isTokenExpiringSoon(
  expiresAt: Date,
  thresholdMinutes: number = DEFAULT_THRESHOLD_MINUTES,
): boolean {
  const now = new Date();
  const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60);
  return minutesUntilExpiry <= thresholdMinutes;
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * DBからトークンを取得
 */
export async function getTokenFromDb(
  supabase: SupabaseClient,
): Promise<DbToken | null> {
  const { data, error } = await supabase
    .schema(SCHEMA)
    .from(TABLE)
    .select("*")
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // レコードなし
      return null;
    }
    throw new Error(`Token fetch error: ${error.message}`);
  }

  return data as DbToken;
}

/**
 * トークンをDBに保存（upsert）
 */
export async function saveTokenToDb(
  supabase: SupabaseClient,
  token: Partial<DbToken>,
  existingId?: string,
): Promise<void> {
  const now = new Date().toISOString();

  if (existingId) {
    // 既存レコード更新
    const { error } = await supabase
      .schema(SCHEMA)
      .from(TABLE)
      .update({
        ...token,
        updated_at: now,
        last_refreshed_at: now,
      })
      .eq("id", existingId);

    if (error) {
      throw new Error(`Token update error: ${error.message}`);
    }
  } else {
    // 新規作成
    const { error } = await supabase
      .schema(SCHEMA)
      .from(TABLE)
      .insert({
        ...token,
        created_at: now,
        updated_at: now,
        last_refreshed_at: now,
      });

    if (error) {
      throw new Error(`Token create error: ${error.message}`);
    }
  }
}

// =============================================================================
// API Operations
// =============================================================================

/**
 * Basic認証ヘッダーを生成
 */
function getBasicAuthHeader(): string {
  const clientId = Deno.env.get("FITBIT_CLIENT_ID");
  const clientSecret = Deno.env.get("FITBIT_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET are required");
  }

  const credentials = `${clientId}:${clientSecret}`;
  return `Basic ${encodeBase64(new TextEncoder().encode(credentials))}`;
}

/**
 * リフレッシュトークンでアクセストークンを更新
 */
export async function refreshTokenFromApi(
  refreshToken: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": getBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Refresh error: ${response.status} - ${errorText}`);
  }

  return await response.json() as TokenResponse;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * 有効なアクセストークンを保証して返す
 * - DBの expires_at をチェック（APIを叩かない）
 * - 閾値内 or forceRefresh なら API でリフレッシュ
 */
export async function ensureValidToken(
  options: AuthOptions = {},
): Promise<string> {
  const { forceRefresh = false, thresholdMinutes = DEFAULT_THRESHOLD_MINUTES } =
    options;

  const supabase = createSupabaseClient();
  const token = await getTokenFromDb(supabase);

  if (!token) {
    throw new Error(
      "Token not found in DB. Please register token manually.",
    );
  }

  const expiresAt = new Date(token.expires_at);
  const needsRefresh = forceRefresh ||
    isTokenExpiringSoon(expiresAt, thresholdMinutes);

  if (!needsRefresh) {
    const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60);
    log.success(`Token valid (${minutesUntilExpiry.toFixed(0)} min remaining)`);
    return token.access_token;
  }

  log.info("Refreshing token...");
  const newToken = await refreshTokenFromApi(token.refresh_token);

  // 新しいトークンをDBに保存
  const newExpiresAt = new Date(Date.now() + newToken.expires_in * 1000);
  await saveTokenToDb(
    supabase,
    {
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
      token_type: newToken.token_type || "Bearer",
      expires_at: newExpiresAt.toISOString(),
      scope: newToken.scope,
      user_id: newToken.user_id,
    },
    token.id,
  );

  log.success(`Token refreshed (expires: ${newExpiresAt.toISOString()})`);
  return newToken.access_token;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["refresh", "help"],
    alias: { h: "help", r: "refresh" },
  });

  if (args.help) {
    console.log(`
Fitbit OAuth2.0 Auth Manager

Usage:
  deno run --allow-env --allow-net --allow-read auth.ts [options]

Options:
  --help, -h      Show this help
  --refresh, -r   Force token refresh

Examples:
  # Check validity (refresh if needed)
  deno run --allow-env --allow-net --allow-read auth.ts

  # Force refresh
  deno run --allow-env --allow-net --allow-read auth.ts --refresh

Environment Variables:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  FITBIT_CLIENT_ID          Fitbit Client ID
  FITBIT_CLIENT_SECRET      Fitbit Client Secret
`);
    Deno.exit(0);
  }

  // 通常実行: 有効性確認（必要ならリフレッシュ）
  try {
    await ensureValidToken({ forceRefresh: args.refresh });
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

// CLI実行
if (import.meta.main) {
  main();
}
