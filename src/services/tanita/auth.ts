/**
 * Tanita Health Planet OAuth2.0 認証管理
 *
 * 認証情報は credentials.services テーブルから取得・保存。
 * トークンリフレッシュ時は自動的に credentials.services を更新。
 *
 * 使用例:
 *   deno run --allow-env --allow-net --allow-read auth.ts              # 有効性確認（必要ならリフレッシュ）
 *   deno run --allow-env --allow-net --allow-read auth.ts --refresh    # 強制リフレッシュ
 *   deno run --allow-env --allow-net --allow-read auth.ts --init       # 初回トークン取得（TANITA_AUTH_CODE必要）
 */

import "jsr:@std/dotenv/load";
import { parseArgs } from "jsr:@std/cli/parse-args";
import * as log from "../../utils/log.ts";
import {
  getCredentials,
  updateCredentials,
  saveCredentials,
  type OAuth2Credentials,
} from "../../utils/credentials.ts";
import type { AuthOptions, TokenResponse } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const OAUTH_TOKEN_URL = "https://www.healthplanet.jp/oauth/token";
const REDIRECT_URI = "https://www.healthplanet.jp/success.html";
const DEFAULT_THRESHOLD_DAYS = 7;

// =============================================================================
// Token Validation
// =============================================================================

/**
 * トークンが期限切れ間近かどうかを判定
 * @param expiresAt 有効期限
 * @param thresholdDays 閾値（日数）
 */
export function isTokenExpiringSoon(
  expiresAt: Date,
  thresholdDays: number = DEFAULT_THRESHOLD_DAYS,
): boolean {
  const now = new Date();
  const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) /
    (1000 * 60 * 60 * 24);
  return daysUntilExpiry <= thresholdDays;
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
  const result = await getCredentials<OAuth2Credentials>("tanita");
  if (!result) {
    throw new Error("Tanita credentials not found in credentials.services");
  }

  const { credentials, expiresAt } = result;

  // 必須フィールドの検証
  if (!credentials.client_id || !credentials.client_secret) {
    throw new Error("Tanita credentials missing client_id or client_secret");
  }
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error("Tanita credentials missing access_token or refresh_token. Use --init to get initial token.");
  }

  return { credentials, expiresAt };
}

// =============================================================================
// API Operations
// =============================================================================

/**
 * 認可コードからトークンを取得（初回のみ）
 */
export async function getInitialToken(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    code: code,
    grant_type: "authorization_code",
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Initial token error: ${response.status} - ${errorText}`,
    );
  }

  const data = await response.json();
  return data as TokenResponse;
}

/**
 * リフレッシュトークンでアクセストークンを更新
 * @returns TokenResponse（更新された場合）または null（SUCCESSの場合）
 */
export async function refreshTokenFromApi(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TokenResponse | null> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Refresh error: ${response.status} - ${errorText}`);
  }

  const responseText = await response.text();

  // "SUCCESS" の場合はトークンが既に有効
  if (responseText.trim() === "SUCCESS") {
    return null;
  }

  // JSONをパース
  try {
    return JSON.parse(responseText) as TokenResponse;
  } catch {
    throw new Error(`Response parse error: ${responseText}`);
  }
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
  const { forceRefresh = false, thresholdDays = DEFAULT_THRESHOLD_DAYS } =
    options;

  const { credentials, expiresAt } = await loadCredentials();

  // expires_at が null の場合はリフレッシュ必要
  const needsRefresh = forceRefresh ||
    !expiresAt ||
    isTokenExpiringSoon(expiresAt, thresholdDays);

  if (!needsRefresh && expiresAt) {
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) /
      (1000 * 60 * 60 * 24);
    log.success(`Token valid (${daysUntilExpiry.toFixed(1)} days remaining)`);
    return credentials.access_token;
  }

  log.info("Refreshing token...");
  const newToken = await refreshTokenFromApi(
    credentials.client_id,
    credentials.client_secret,
    credentials.refresh_token,
  );

  if (newToken === null) {
    // SUCCESS: トークンは既に有効
    log.success("Token already valid (API returned SUCCESS)");
    return credentials.access_token;
  }

  // 新しい有効期限を計算
  const newExpiresAt = new Date(Date.now() + newToken.expires_in * 1000);

  // credentials.services を更新
  await updateCredentials(
    "tanita",
    {
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
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
    boolean: ["refresh", "init", "help"],
    string: ["code"],
    alias: { h: "help", r: "refresh", i: "init", c: "code" },
  });

  if (args.help) {
    console.log(`
Tanita Health Planet OAuth2.0 Auth Manager

Usage:
  deno run --allow-env --allow-net --allow-read auth.ts [options]

Options:
  --help, -h      Show this help
  --refresh, -r   Force token refresh
  --init, -i      Get initial token (requires --code)
  --code, -c      Authorization code (used with --init)

Examples:
  # Check validity (refresh if needed)
  deno run --allow-env --allow-net --allow-read auth.ts

  # Force refresh
  deno run --allow-env --allow-net --allow-read auth.ts --refresh

  # Get initial token
  deno run --allow-env --allow-net --allow-read auth.ts --init --code=YOUR_AUTH_CODE

Environment Variables:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  TOKEN_ENCRYPTION_KEY      Encryption key for credentials
  TANITA_AUTH_CODE          Authorization code (alternative to --code, for --init)
`);
    Deno.exit(0);
  }

  if (args.init) {
    // 初回トークン取得
    const code = args.code || Deno.env.get("TANITA_AUTH_CODE");
    if (!code) {
      log.error("--code or TANITA_AUTH_CODE is required");
      Deno.exit(1);
    }

    // 既存の credentials を取得（client_id/client_secret のみ必要）
    const result = await getCredentials<OAuth2Credentials>("tanita");
    if (!result) {
      log.error("Tanita credentials not found. Please save client_id and client_secret first.");
      Deno.exit(1);
    }

    const { credentials } = result;
    if (!credentials.client_id || !credentials.client_secret) {
      log.error("Tanita credentials missing client_id or client_secret");
      Deno.exit(1);
    }

    log.info("Exchanging authorization code for token...");
    const tokenResponse = await getInitialToken(
      credentials.client_id,
      credentials.client_secret,
      code,
    );
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // credentials.services を更新
    await saveCredentials(
      "tanita",
      "oauth2",
      {
        ...credentials,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        scope: "innerscan,sphygmomanometer,pedometer",
      },
      expiresAt,
    );

    log.success("Initial token saved");
    log.info(`Expires: ${expiresAt.toISOString()}`);
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
