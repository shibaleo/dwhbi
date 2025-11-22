// zaim/api.ts

import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimOAuth } from "./oauth.ts";
import type {
  ZaimTransaction,
  ZaimCategory,
  ZaimGenre,
  ZaimAccount
} from "./types.ts";

export class ZaimAPI {
  private oauth: ZaimOAuth;
  private baseUrl = "https://api.zaim.net/v2";

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
  }): Promise<{ money: ZaimTransaction[] }> {
    const url = new URL(`${this.baseUrl}/home/money`);

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
  async getCategories(): Promise<{ categories: ZaimCategory[] }> {
    const url = `${this.baseUrl}/home/category`;
    return await this.oauth.get(url);
  }

  // ジャンル一覧取得
  async getGenres(): Promise<{ genres: ZaimGenre[] }> {
    const url = `${this.baseUrl}/home/genre`;
    return await this.oauth.get(url);
  }

  // 口座一覧取得
  async getAccounts(): Promise<{ accounts: ZaimAccount[] }> {
    const url = `${this.baseUrl}/home/account`;
    return await this.oauth.get(url);
  }

  // ユーザー情報確認
  async verifyUser(): Promise<any> {
    const url = `${this.baseUrl}/home/user/verify`;
    return await this.oauth.get(url);
  }
}