/**
 * Zaim OAuth 1.0a 認証クライアント
 *
 * OAuth 1.0a 署名付きリクエストを生成するクラス。
 * トークンは環境変数から取得（リフレッシュ不要）。
 */
import OAuth from "npm:oauth-1.0a@2.2.6";
import { createHmac } from "node:crypto";
import type { OAuth1Credentials } from "./types.ts";

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

  async get(url: string): Promise<unknown> {
    const authHeader = this.oauth.toHeader(
      this.oauth.authorize({ url, method: "GET" }, this.token)
    );

    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Zaim API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async post(url: string, body: Record<string, unknown>): Promise<unknown> {
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

    if (!response.ok) {
      throw new Error(`Zaim API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}
