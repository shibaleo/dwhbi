// client.ts - Toggl APIクライアント（認証・リトライ）

import "https://deno.land/std@0.203.0/dotenv/load.ts";

// --- Configuration ---
const config = {
  apiToken: Deno.env.get("TOGGL_API_TOKEN")?.trim(),
  workspaceId: Deno.env.get("TOGGL_WORKSPACE_ID")?.trim(),
  baseUrl: "https://api.track.toggl.com/api/v9",
};

if (!config.apiToken || !config.workspaceId) {
  throw new Error("TOGGL_API_TOKEN or TOGGL_WORKSPACE_ID is not set in environment");
}

// --- Authentication header ---
const authHeader = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${config.apiToken}:api_token`)}`,
};

// --- Utilities ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 500系エラーかどうかを判定
 */
function isServerError(status: number): boolean {
  return status >= 500 && status < 600;
}

/**
 * リトライ設定
 */
interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  retryDelay: 2000,
};

/**
 * Toggl APIへのfetchを実行（500系のみリトライ）
 * @param endpoint APIエンドポイント（/workspaces/... など）
 * @param retryConfig リトライ設定
 * @returns レスポンスデータ
 */
export async function togglFetch<T>(
  endpoint: string,
  retryConfig: RetryConfig = defaultRetryConfig
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${config.baseUrl}${endpoint}`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const res = await fetch(url, { headers: authHeader });

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
        await delay(retryConfig.retryDelay);
        continue;
      }
    } else {
      // 4xx系エラーは即座にthrow
      throw new Error(errorMessage);
    }
  }

  throw lastError ?? new Error("Unknown error during Toggl API fetch");
}

/**
 * ワークスペースID
 */
export const workspaceId = config.workspaceId;
