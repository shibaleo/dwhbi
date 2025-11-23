/**
 * Notion API 認証クライアント
 *
 * Internal Integration Token による Bearer 認証を提供。
 * トークンは環境変数から取得（リフレッシュ不要）。
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import {
  NOTION_API_VERSION,
  NOTION_API_BASE_URL,
  NOTION_RATE_LIMIT_WAIT_SECONDS,
  NotionRateLimitError,
} from "./types.ts";

// =============================================================================
// Configuration
// =============================================================================

function loadConfig() {
  const integrationSecret = Deno.env.get("NOTION_INTEGRATION_SECRET")?.trim();
  const metadataTableId = Deno.env.get("NOTION_METADATA_TABLE_ID")?.trim();

  if (!integrationSecret) {
    throw new Error("NOTION_INTEGRATION_SECRET is not set in environment");
  }

  if (!metadataTableId) {
    throw new Error("NOTION_METADATA_TABLE_ID is not set in environment");
  }

  return { integrationSecret, metadataTableId };
}

const config = loadConfig();

// =============================================================================
// Authentication Headers
// =============================================================================

/**
 * Notion API 認証ヘッダーを生成
 */
function getAuthHeaders(): Record<string, string> {
  return {
    "Authorization": `Bearer ${config.integrationSecret}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_API_VERSION,
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
 * Notion APIへの認証付きGETリクエストを実行
 * @param endpoint APIエンドポイント（/databases/... など）
 * @param retryConfig リトライ設定
 * @returns レスポンスデータ
 */
export async function notionFetch<T>(
  endpoint: string,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${NOTION_API_BASE_URL}${endpoint}`;

  const authHeaders = getAuthHeaders();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders,
    });

    if (res.ok) {
      return await res.json();
    }

    const text = await res.text();
    const errorMessage = `Notion API error: ${res.status} ${res.statusText}\n${text}`;

    // 429: レート制限
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitSeconds = retryAfter
        ? parseInt(retryAfter, 10)
        : NOTION_RATE_LIMIT_WAIT_SECONDS;
      throw new NotionRateLimitError(waitSeconds);
    }

    // 500系エラーの場合のみリトライ
    if (isServerError(res.status)) {
      lastError = new Error(errorMessage);

      if (attempt < retryConfig.maxRetries) {
        console.warn(
          `[WARN] Notion API returned ${res.status}, retrying in ${retryConfig.retryDelay}ms (attempt ${attempt}/${retryConfig.maxRetries})`
        );
        await sleep(retryConfig.retryDelay);
        continue;
      }
    } else {
      // 4xx系エラーは即座にthrow
      throw new Error(errorMessage);
    }
  }

  throw lastError ?? new Error("Unknown error during Notion API fetch");
}

/**
 * Notion APIへの認証付きPOSTリクエストを実行
 * @param endpoint APIエンドポイント（/databases/{id}/query など）
 * @param body リクエストボディ
 * @param retryConfig リトライ設定
 * @returns レスポンスデータ
 */
export async function notionPost<T>(
  endpoint: string,
  body: object,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${NOTION_API_BASE_URL}${endpoint}`;

  const authHeaders = getAuthHeaders();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return await res.json();
    }

    const text = await res.text();
    const errorMessage = `Notion API error: ${res.status} ${res.statusText}\n${text}`;

    // 429: レート制限
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitSeconds = retryAfter
        ? parseInt(retryAfter, 10)
        : NOTION_RATE_LIMIT_WAIT_SECONDS;
      throw new NotionRateLimitError(waitSeconds);
    }

    // 500系エラーの場合のみリトライ
    if (isServerError(res.status)) {
      lastError = new Error(errorMessage);

      if (attempt < retryConfig.maxRetries) {
        console.warn(
          `[WARN] Notion API returned ${res.status}, retrying in ${retryConfig.retryDelay}ms (attempt ${attempt}/${retryConfig.maxRetries})`
        );
        await sleep(retryConfig.retryDelay);
        continue;
      }
    } else {
      // 4xx系エラーは即座にthrow
      throw new Error(errorMessage);
    }
  }

  throw lastError ?? new Error("Unknown error during Notion API fetch");
}

/**
 * Notion APIへの認証付きPATCHリクエストを実行
 * @param endpoint APIエンドポイント
 * @param body リクエストボディ
 * @param retryConfig リトライ設定
 * @returns レスポンスデータ
 */
export async function notionPatch<T>(
  endpoint: string,
  body: object,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${NOTION_API_BASE_URL}${endpoint}`;

  const authHeaders = getAuthHeaders();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return await res.json();
    }

    const text = await res.text();
    const errorMessage = `Notion API error: ${res.status} ${res.statusText}\n${text}`;

    // 429: レート制限
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitSeconds = retryAfter
        ? parseInt(retryAfter, 10)
        : NOTION_RATE_LIMIT_WAIT_SECONDS;
      throw new NotionRateLimitError(waitSeconds);
    }

    // 500系エラーの場合のみリトライ
    if (isServerError(res.status)) {
      lastError = new Error(errorMessage);

      if (attempt < retryConfig.maxRetries) {
        console.warn(
          `[WARN] Notion API returned ${res.status}, retrying in ${retryConfig.retryDelay}ms (attempt ${attempt}/${retryConfig.maxRetries})`
        );
        await sleep(retryConfig.retryDelay);
        continue;
      }
    } else {
      // 4xx系エラーは即座にthrow
      throw new Error(errorMessage);
    }
  }

  throw lastError ?? new Error("Unknown error during Notion API fetch");
}

// =============================================================================
// Exports
// =============================================================================

/**
 * メタテーブルID
 */
export const metadataTableId = config.metadataTableId;
