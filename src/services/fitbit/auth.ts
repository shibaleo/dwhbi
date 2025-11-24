/**
 * Fitbit OAuth2.0 認証管理
 *
 * 認証情報は credentials.services テーブルから取得・保存。
 * トークンリフレッシュ時は自動的に credentials.services を更新。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read auth.ts              # 有効性確認（必要ならリフレッシュ）
 *   deno run --allow-env --allow-net --allow-read auth.ts --refresh    # 強制リフレッシュ
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import * as log from "../../utils/log.ts";
import {
  getCredentials,
  updateCredentials,
  updateExpiresAt,
  type OAuth2Credentials,
} from "../../utils/credentials.ts";
import type { AuthOptions, TokenResponse } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const OAUTH_TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const DEFAULT_THRESHOLD_MINUTES = 60; // 1時間前にリフレッシュ

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
// Credential Operations
// =============================================================================

/**
 * 認証情報を credentials.services から取得
 */
async function loadCredentials(): Promise<{
  credentials: OAuth2Credentials;
  expiresAt: Date | null;
}> {
  const result = await getCredentials<OAuth2Credentials>("fitbit");
  if (!result) {
    throw new Error("Fitbit credentials not found in credentials.services");
  }

  const { credentials, expiresAt } = result;

  // 必須フィールドの検証
  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Fitbit credentials missing client_id or client_secret");
  }
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error("Fitbit credentials missing access_token or refresh_token");
  }

  return { credentials, expiresAt };
}

// =============================================================================
// API Operations
// =============================================================================

/**
 * Basic認証ヘッダーを生成
 */
function getBasicAuthHeader(clientId: string, clientSecret: string): string {
  const credentials = `${clientId}:${clientSecret}`;
  return `Basic ${encodeBase64(new TextEncoder().encode(credentials))}`;
}

/**
 * リフレッシュトークンでアクセストークンを更新
 */
export async function refreshTokenFromApi(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": getBasicAuthHeader(clientId, clientSecret),
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
 * - credentials.services の expires_at をチェック
 * - 閾値内 or forceRefresh なら API でリフレッシュ
 */
export async function ensureValidToken(
  options: AuthOptions = {},
): Promise<string> {
  const { forceRefresh = false, thresholdMinutes = DEFAULT_THRESHOLD_MINUTES } =
    options;

  const { credentials, expiresAt } = await loadCredentials();

  // expires_at が null の場合はリフレッシュ必要
  const needsRefresh = forceRefresh ||
    !expiresAt ||
    isTokenExpiringSoon(expiresAt, thresholdMinutes);

  if (!needsRefresh && expiresAt) {
    const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60);
    log.success(`Token valid (${minutesUntilExpiry.toFixed(0)} min remaining)`);
    return credentials.access_token;
  }

  log.info("Refreshing token...");
  const newToken = await refreshTokenFromApi(
    credentials.client_id,
    credentials.client_secret,
    credentials.refresh_token,
  );

  // 新しい有効期限を計算
  const newExpiresAt = new Date(Date.now() + newToken.expires_in * 1000);

  // credentials.services を更新
  await updateCredentials(
    "fitbit",
    {
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
      scope: newToken.scope,
      user_id: newToken.user_id,
    },
    newExpiresAt,
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
  TOKEN_ENCRYPTION_KEY      Encryption key for credentials
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
