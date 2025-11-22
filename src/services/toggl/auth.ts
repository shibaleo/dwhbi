/**
 * Toggl Track API 認証クライアント
 *
 * API Token による Basic 認証を提供。
 * トークンは環境変数から取得（リフレッシュ不要）。
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = "https://api.track.toggl.com/api/v9";

// =============================================================================
// Configuration
// =============================================================================

function loadConfig() {
  const apiToken = Deno.env.get("TOGGL_API_TOKEN")?.trim();
  const workspaceId = Deno.env.get("TOGGL_WORKSPACE_ID")?.trim();

  if (!apiToken || !workspaceId) {
    throw new Error("TOGGL_API_TOKEN or TOGGL_WORKSPACE_ID is not set in environment");
  }

  return { apiToken, workspaceId };
}

const config = loadConfig();

// =============================================================================
// Authentication
// =============================================================================

/**
 * Basic認証ヘッダーを生成
 */
function getAuthHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Basic ${btoa(`${config.apiToken}:api_token`)}`,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 500系エラーかどうかを判定
 */
function isServerError(status: number): boolean {
  return status >= 500 && status < 600;
}

// =============================================================================
// Retry Configuration
// =============================================================================

interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelay: 2000,
};

// =============================================================================
// API Client
// =============================================================================

/**
 * Toggl APIへの認証付きfetchを実行（500系のみリトライ）
 * @param endpoint APIエンドポイント（/workspaces/... など）
 * @param retryConfig リトライ設定
 * @returns レスポンスデータ
 */
export async function togglFetch<T>(
  endpoint: string,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${BASE_URL}${endpoint}`;

  const authHeaders = getAuthHeaders();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const res = await fetch(url, { headers: authHeaders });

    if (res.ok) {
      return await res.json();
    }

    const text = await res.text();
    const errorMessage = `Toggl API error: ${res.status} ${res.statusText}\n${text}`;

    // 500系エラーの場合のみリトライ
    if (isServerError(res.status)) {
      lastError = new Error(errorMessage);

      if (attempt < retryConfig.maxRetries) {
        console.warn(`[WARN] Toggl API returned ${res.status}, retrying in ${retryConfig.retryDelay}ms (attempt ${attempt}/${retryConfig.maxRetries})`);
        await sleep(retryConfig.retryDelay);
        continue;
      }
    } else {
      // 4xx系エラーは即座にthrow
      throw new Error(errorMessage);
    }
  }

  throw lastError ?? new Error("Unknown error during Toggl API fetch");
}

// =============================================================================
// Exports
// =============================================================================

/**
 * ワークスペースID
 */
export const workspaceId = config.workspaceId;
