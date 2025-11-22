/**
 * Zaim API クライアント
 */

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimOAuth } from "./auth.ts";
import type {
  ZaimApiTransaction,
  ZaimApiCategory,
  ZaimApiGenre,
  ZaimApiAccount,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = "https://api.zaim.net/v2";

// =============================================================================
// API Client
// =============================================================================

export class ZaimAPI {
  private oauth: ZaimOAuth;

  constructor() {
    const consumerKey = Deno.env.get("ZAIM_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("ZAIM_CONSUMER_SECRET");
    const accessToken = Deno.env.get("ZAIM_ACCESS_TOKEN");
    const accessTokenSecret = Deno.env.get("ZAIM_ACCESS_TOKEN_SECRET");

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      throw new Error("Zaim API credentials not found in environment variables");
    }

    this.oauth = new ZaimOAuth({
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
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
    const url = new URL(`${BASE_URL}/home/money`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });
    }

    return await this.oauth.get(url.toString());
  }

  // カテゴリ一覧取得
  async getCategories(): Promise<{ categories: ZaimApiCategory[] }> {
    const url = `${BASE_URL}/home/category`;
    return await this.oauth.get(url);
  }

  // ジャンル一覧取得
  async getGenres(): Promise<{ genres: ZaimApiGenre[] }> {
    const url = `${BASE_URL}/home/genre`;
    return await this.oauth.get(url);
  }

  // 口座一覧取得
  async getAccounts(): Promise<{ accounts: ZaimApiAccount[] }> {
    const url = `${BASE_URL}/home/account`;
    return await this.oauth.get(url);
  }

  // ユーザー情報確認
  async verifyUser(): Promise<unknown> {
    const url = `${BASE_URL}/home/user/verify`;
    return await this.oauth.get(url);
  }
}
