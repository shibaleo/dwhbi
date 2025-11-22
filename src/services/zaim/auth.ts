/**
 * Zaim OAuth 1.0a 認証クライアント
 *
 * OAuth 1.0a 署名付きリクエストを生成するクラス。
 * トークンは環境変数から取得（リフレッシュ不要）。
 */
import OAuth from "npm:oauth-1.0a@2.2.6";
import { createHmac } from "node:crypto";
import type { OAuth1Credentials } from "./types.ts";
import { ZaimRateLimitError, ZaimApiError } from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** デフォルトのRetry-After秒数（ヘッダーがない場合） */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

// =============================================================================
// OAuth Client
// =============================================================================

export class ZaimOAuth {
  private oauth: OAuth;
  private token: { key: string; secret: string };

  constructor(config: OAuth1Credentials) {
    this.oauth = new OAuth({
      consumer: {
        key: config.consumerKey,
        secret: config.consumerSecret,
      },
      signature_method: "HMAC-SHA1",
      hash_function(baseString, key) {
        return createHmac("sha1", key).update(baseString).digest("base64");
      },
    });

    this.token = {
      key: config.accessToken,
      secret: config.accessTokenSecret,
    };
  }

  /**
   * レスポンスを処理し、エラーをハンドリング
   */
  private handleResponse(response: Response): void {
    if (response.ok) {
      return;
    }

    // レート制限エラー（429）
    if (response.status === 429) {
      const retryAfter = this.parseRetryAfter(response.headers);
      throw new ZaimRateLimitError(retryAfter);
    }

    // その他のエラー
    throw new ZaimApiError(response.status, response.statusText);
  }

  /**
   * Retry-Afterヘッダーをパース
   * - 数値の場合: そのまま秒数として使用
   * - HTTP-dateの場合: 現在時刻との差を秒数に変換
   * - ない場合: デフォルト値を使用
   */
  private parseRetryAfter(headers: Headers): number {
    const retryAfter = headers.get("Retry-After");

    if (!retryAfter) {
      return DEFAULT_RETRY_AFTER_SECONDS;
    }

    // 数値の場合
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }

    // HTTP-dateの場合
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      const diffMs = date.getTime() - Date.now();
      return Math.max(1, Math.ceil(diffMs / 1000));
    }

    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  async get<T = unknown>(url: string): Promise<T> {
    const authHeader = this.oauth.toHeader(
      this.oauth.authorize({ url, method: "GET" }, this.token)
    );

    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...authHeader,
      },
    });

    this.handleResponse(response);
    return response.json() as Promise<T>;
  }

  async post<T = unknown>(url: string, body: Record<string, unknown>): Promise<T> {
    const authHeader = this.oauth.toHeader(
      this.oauth.authorize({ url, method: "POST" }, this.token)
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    this.handleResponse(response);
    return response.json() as Promise<T>;
  }
}
