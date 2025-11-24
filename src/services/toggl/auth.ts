/**
 * Toggl Track API 認証クライアント
 *
 * API Token による Basic 認証を提供。
 * トークンは credentials.services テーブルから取得（リフレッシュ不要）。
 */

import "jsr:@std/dotenv/load";
import {
  getCredentials,
  type BasicCredentials,
} from "../../utils/credentials.ts";

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = "https://api.track.toggl.com/api/v9";

// =============================================================================
// Configuration Cache
// =============================================================================

let _config: { apiToken: string; workspaceId: string } | null = null;

/**
 * 認証情報を credentials.services から取得（キャッシュ付き）
 */
async function loadConfig(): Promise<{ apiToken: string; workspaceId: string }> {
  if (_config) return _config;

  const result = await getCredentials<BasicCredentials>("toggl");
  if (!result) {
    throw new Error("Toggl credentials not found in credentials.services");
  }

  const { credentials } = result;
  if (!credentials.api_token || !credentials.workspace_id) {
    throw new Error("Toggl credentials missing api_token or workspace_id");
  }

  _config = {
    apiToken: credentials.api_token,
    workspaceId: credentials.workspace_id,
  };

  return _config;
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Basic認証ヘッダーを生成
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const config = await loadConfig();
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

  const authHeaders = await getAuthHeaders();
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
 * ワークスペースIDを取得
 */
export async function getWorkspaceId(): Promise<string> {
  const config = await loadConfig();
  return config.workspaceId;
}
