/**
 * Zaim API クライアント
 */

import "jsr:@std/dotenv/load";
import { ZaimOAuth } from "./auth.ts";
import type {
  ZaimApiTransaction,
  ZaimApiCategory,
  ZaimApiGenre,
  ZaimApiAccount,
} from "./types.ts";
import {
  getCredentials,
  type OAuth1Credentials,
} from "../../utils/credentials.ts";

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = "https://api.zaim.net/v2";

// =============================================================================
// API Client
// =============================================================================

export class ZaimAPI {
  private oauth: ZaimOAuth | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // 認証情報の取得は非同期なので、別途初期化
  }

  /**
   * OAuthクライアントを初期化（遅延初期化）
   */
  private async ensureInitialized(): Promise<ZaimOAuth> {
    if (this.oauth) return this.oauth;

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;

    return this.oauth!;
  }

  private async initialize(): Promise<void> {
    const result = await getCredentials<OAuth1Credentials>("zaim");
    if (!result) {
      throw new Error("Zaim credentials not found in credentials.services");
    }

    const { credentials } = result;
    if (!credentials.consumer_key || !credentials.consumer_secret ||
        !credentials.access_token || !credentials.access_token_secret) {
      throw new Error("Zaim credentials missing required fields");
    }

    this.oauth = new ZaimOAuth({
      consumerKey: credentials.consumer_key,
      consumerSecret: credentials.consumer_secret,
      accessToken: credentials.access_token,
      accessTokenSecret: credentials.access_token_secret,
    });
  }

  // 取引データ取得
  async getMoney(params?: {
    category_id?: number;
    genre_id?: number;
    mode?: "payment" | "income";
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
  }): Promise<{ money: ZaimApiTransaction[] }> {
    const oauth = await this.ensureInitialized();
    const url = new URL(`${BASE_URL}/home/money`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });
    }

    return await oauth.get(url.toString());
  }

  // カテゴリ一覧取得
  async getCategories(): Promise<{ categories: ZaimApiCategory[] }> {
    const oauth = await this.ensureInitialized();
    const url = `${BASE_URL}/home/category`;
    return await oauth.get(url);
  }

  // ジャンル一覧取得
  async getGenres(): Promise<{ genres: ZaimApiGenre[] }> {
    const oauth = await this.ensureInitialized();
    const url = `${BASE_URL}/home/genre`;
    return await oauth.get(url);
  }

  // 口座一覧取得
  async getAccounts(): Promise<{ accounts: ZaimApiAccount[] }> {
    const oauth = await this.ensureInitialized();
    const url = `${BASE_URL}/home/account`;
    return await oauth.get(url);
  }

  // ユーザー情報確認
  async verifyUser(): Promise<unknown> {
    const oauth = await this.ensureInitialized();
    const url = `${BASE_URL}/home/user/verify`;
    return await oauth.get(url);
  }
}
