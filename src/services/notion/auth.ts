/**
 * Notion API 認証クライアント
 *
 * Internal Integration Token による Bearer 認証を提供。
 * トークンは credentials.services テーブルから取得（リフレッシュ不要）。
 */

import "jsr:@std/dotenv/load";
import {
  getCredentials,
  type ApiKeyCredentials,
} from "../../utils/credentials.ts";
import {
  NOTION_API_VERSION,
  NOTION_API_BASE_URL,
  NOTION_RATE_LIMIT_WAIT_SECONDS,
  NotionRateLimitError,
} from "./types.ts";

// =============================================================================
// Configuration Cache
// =============================================================================

let _config: { integrationSecret: string; metadataTableId: string } | null = null;

/**
 * 認証情報を credentials.services から取得（キャッシュ付き）
 */
async function loadConfig(): Promise<{ integrationSecret: string; metadataTableId: string }> {
  if (_config) return _config;

  const result = await getCredentials<ApiKeyCredentials>("notion");
  if (!result) {
    throw new Error("Notion credentials not found in credentials.services");
  }

  const { credentials } = result;
  if (!credentials.api_key) {
    throw new Error("Notion credentials missing api_key");
  }
  if (!credentials.metadata_table_id) {
    throw new Error("Notion credentials missing metadata_table_id");
  }

  _config = {
    integrationSecret: credentials.api_key,
    metadataTableId: credentials.metadata_table_id,
  };

  return _config;
}

// =============================================================================
// Authentication Headers
// =============================================================================

/**
 * Notion API 認証ヘッダーを生成
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const config = await loadConfig();
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

  const authHeaders = await getAuthHeaders();
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

  const authHeaders = await getAuthHeaders();
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

  const authHeaders = await getAuthHeaders();
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
 * メタテーブルIDを取得
 */
export async function getMetadataTableId(): Promise<string> {
  const config = await loadConfig();
  return config.metadataTableId;
}
