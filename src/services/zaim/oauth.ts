// zaim/oauth.ts

import { crypto } from "https://deno.land/std@0.210.0/crypto/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.210.0/encoding/base64.ts";

interface OAuthConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export class ZaimOAuth {
  private config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  // OAuth 1.0a署名を生成
  private async generateSignature(
    method: string,
    url: string,
    params: Record<string, string>
  ): Promise<string> {
    const signatureBaseString = this.createSignatureBaseString(
      method,
      url,
      params
    );
    const signingKey = `${encodeURIComponent(this.config.consumerSecret)}&${encodeURIComponent(this.config.accessTokenSecret)}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(signingKey);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signatureBaseString)
    );

    return encodeBase64(new Uint8Array(signature));
  }

  private createSignatureBaseString(
    method: string,
    url: string,
    params: Record<string, string>
  ): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join("&");

    return `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  }

  // OAuth認証ヘッダーを生成
  private async createAuthHeader(
    method: string,
    url: string
  ): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID().replace(/-/g, "");

    const params: Record<string, string> = {
      oauth_consumer_key: this.config.consumerKey,
      oauth_token: this.config.accessToken,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: "1.0",
    };

    const signature = await this.generateSignature(method, url, params);
    params.oauth_signature = signature;

    const authParams = Object.keys(params)
      .sort()
      .map((key) => `${encodeURIComponent(key)}="${encodeURIComponent(params[key])}"`)
      .join(", ");

    return `OAuth ${authParams}`;
  }

  // GETリクエスト
  async get(url: string): Promise<any> {
    const authHeader = await this.createAuthHeader("GET", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Zaim API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // POSTリクエスト（将来的に必要になる場合）
  async post(url: string, body: Record<string, any>): Promise<any> {
    const authHeader = await this.createAuthHeader("POST", url);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
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