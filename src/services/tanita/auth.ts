// auth.ts
// Tanita Health Planet OAuth2.0 認証管理
//
// 使用例:
//   deno run --allow-env --allow-net --allow-read auth.ts              # 有効性確認（必要ならリフレッシュ）
//   deno run --allow-env --allow-net --allow-read auth.ts --refresh    # 強制リフレッシュ
//   deno run --allow-env --allow-net --allow-read auth.ts --init       # 初回トークン取得（TANITA_AUTH_CODE必要）

import "jsr:@std/dotenv/load";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseArgs } from "jsr:@std/cli/parse-args";
import type { AuthOptions, DbToken, TokenResponse } from "./types.ts";

// ========== 定数 ==========

const OAUTH_TOKEN_URL = "https://www.healthplanet.jp/oauth/token";
const REDIRECT_URI = "https://www.healthplanet.jp/success.html";
const DEFAULT_THRESHOLD_DAYS = 7;
const SCHEMA = "tanita";
const TABLE = "tokens";

// ========== Supabase クライアント ==========

function createTanitaClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY が必要です");
  }

  return createClient(url, key);
}

// ========== トークン有効性チェック（DBのみ参照） ==========

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

// ========== DB操作 ==========

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
    throw new Error(`トークン取得エラー: ${error.message}`);
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
      throw new Error(`トークン更新エラー: ${error.message}`);
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
      throw new Error(`トークン作成エラー: ${error.message}`);
    }
  }
}

// ========== API操作 ==========

/**
 * 認可コードからトークンを取得（初回のみ）
 */
export async function getInitialToken(code: string): Promise<TokenResponse> {
  const clientId = Deno.env.get("TANITA_CLIENT_ID");
  const clientSecret = Deno.env.get("TANITA_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("TANITA_CLIENT_ID, TANITA_CLIENT_SECRET が必要です");
  }

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
      `初回トークン取得エラー: ${response.status} - ${errorText}`,
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
  refreshToken: string,
): Promise<TokenResponse | null> {
  const clientId = Deno.env.get("TANITA_CLIENT_ID");
  const clientSecret = Deno.env.get("TANITA_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("TANITA_CLIENT_ID, TANITA_CLIENT_SECRET が必要です");
  }

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
    throw new Error(`リフレッシュエラー: ${response.status} - ${errorText}`);
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
    throw new Error(`レスポンスパースエラー: ${responseText}`);
  }
}

// ========== メイン関数 ==========

/**
 * 有効なアクセストークンを保証して返す
 * - DBの expires_at をチェック（APIを叩かない）
 * - 閾値内 or forceRefresh なら API でリフレッシュ
 */
export async function ensureValidToken(
  options: AuthOptions = {},
): Promise<string> {
  const { forceRefresh = false, thresholdDays = DEFAULT_THRESHOLD_DAYS } =
    options;

  const supabase = createTanitaClient();
  const token = await getTokenFromDb(supabase);

  if (!token) {
    throw new Error(
      "トークンがDBに存在しません。--init で初回トークンを取得してください",
    );
  }

  const expiresAt = new Date(token.expires_at);
  const needsRefresh = forceRefresh ||
    isTokenExpiringSoon(expiresAt, thresholdDays);

  if (!needsRefresh) {
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) /
      (1000 * 60 * 60 * 24);
    console.log(`✅ トークン有効（残り ${daysUntilExpiry.toFixed(1)} 日）`);
    return token.access_token;
  }

  console.log("🔄 トークンをリフレッシュ中...");
  const newToken = await refreshTokenFromApi(token.refresh_token);

  if (newToken === null) {
    // SUCCESS: トークンは既に有効
    console.log("✅ トークンは既に最新です（APIがSUCCESSを返しました）");
    return token.access_token;
  }

  // 新しいトークンをDBに保存
  const newExpiresAt = new Date(Date.now() + newToken.expires_in * 1000);
  await saveTokenToDb(
    supabase,
    {
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
      token_type: newToken.token_type || "Bearer",
      expires_at: newExpiresAt.toISOString(),
    },
    token.id,
  );

  console.log(
    `✅ トークンをリフレッシュしました（新しい有効期限: ${newExpiresAt.toISOString()}）`,
  );
  return newToken.access_token;
}

// ========== CLI実行 ==========

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["refresh", "init", "help"],
    string: ["code"],
    alias: { h: "help", r: "refresh", i: "init", c: "code" },
  });

  if (args.help) {
    console.log(`
Tanita Health Planet OAuth2.0 認証管理

使用法:
  deno run --allow-env --allow-net --allow-read auth.ts [オプション]

オプション:
  --help, -h      このヘルプを表示
  --refresh, -r   強制的にトークンをリフレッシュ
  --init, -i      初回トークン取得（--code が必要）
  --code, -c      認可コード（--init 時に使用）

例:
  # 有効性確認（必要ならリフレッシュ）
  deno run --allow-env --allow-net --allow-read auth.ts

  # 強制リフレッシュ
  deno run --allow-env --allow-net --allow-read auth.ts --refresh

  # 初回トークン取得
  deno run --allow-env --allow-net --allow-read auth.ts --init --code=YOUR_AUTH_CODE

環境変数:
  SUPABASE_URL              Supabase URL
  SUPABASE_SERVICE_ROLE_KEY Supabase Service Role Key
  TANITA_CLIENT_ID          Tanita Client ID
  TANITA_CLIENT_SECRET      Tanita Client Secret
  TANITA_AUTH_CODE          認可コード（--init で --code を省略した場合）
`);
    Deno.exit(0);
  }

  if (args.init) {
    // 初回トークン取得
    const code = args.code || Deno.env.get("TANITA_AUTH_CODE");
    if (!code) {
      console.error("❌ --code または TANITA_AUTH_CODE が必要です");
      Deno.exit(1);
    }

    console.log("🔑 認可コードをトークンに交換中...");
    const tokenResponse = await getInitialToken(code);
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    const supabase = createTanitaClient();
    const existing = await getTokenFromDb(supabase);

    await saveTokenToDb(
      supabase,
      {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        token_type: tokenResponse.token_type || "Bearer",
        expires_at: expiresAt.toISOString(),
        scope: "innerscan,sphygmomanometer,pedometer",
      },
      existing?.id,
    );

    console.log("✅ 初回トークン取得・保存完了");
    console.log(`   有効期限: ${expiresAt.toISOString()}`);
    Deno.exit(0);
  }

  // 通常実行: 有効性確認（必要ならリフレッシュ）
  try {
    await ensureValidToken({ forceRefresh: args.refresh });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }
}

// CLI実行
if (import.meta.main) {
  main();
}
