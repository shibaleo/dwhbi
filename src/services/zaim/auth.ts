// zaim/oauth.ts

import OAuth from "npm:oauth-1.0a@2.2.6";
import { createHmac } from "node:crypto";
import type { OAuthConfig } from "./types.ts";

export class ZaimOAuth {
  private oauth: OAuth;
  private token: { key: string; secret: string };

  constructor(config: OAuthConfig) {
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

  async get(url: string): Promise<any> {
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

  async post(url: string, body: Record<string, any>): Promise<any> {
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