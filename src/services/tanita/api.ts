// api.ts
// Tanita Health Planet API クライアント

import type { TanitaApiResponse } from "./types.ts";
import {
  INNERSCAN_TAGS,
  PEDOMETER_TAGS,
  SPHYGMOMANOMETER_TAGS,
} from "./types.ts";

// ========== 定数 ==========

const BASE_URL = "https://www.healthplanet.jp/status";

// ========== ヘルパー関数 ==========

/**
 * DateをTanita API形式（YYYYMMDDHHmmss）に変換
 */
export function formatTanitaDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}000000`;
}

/**
 * Tanita API形式（YYYYMMDDHHmm）をDateに変換
 * TanitaのデータはJSTなので、UTCに変換
 */
export function parseTanitaDate(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  const hour = parseInt(dateStr.substring(8, 10));
  const minute = parseInt(dateStr.substring(10, 12));

  // JST → UTC変換（9時間引く）
  return new Date(Date.UTC(year, month, day, hour - 9, minute));
}

// ========== API クライアント ==========

export class TanitaAPI {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * 汎用APIリクエスト
   */
  private async request(
    endpoint: string,
    from: string,
    to: string,
    tag: string,
  ): Promise<TanitaApiResponse> {
    const url = `${BASE_URL}/${endpoint}.json`;
    const params = new URLSearchParams({
      access_token: this.accessToken,
      date: "1", // 測定日付で取得
      from,
      to,
      tag,
    });

    const response = await fetch(`${url}?${params.toString()}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${endpoint} API エラー: ${response.status} - ${errorText}`,
      );
    }

    return await response.json();
  }

  /**
   * 体組成データ取得（innerscan）
   * - 6021: 体重 (kg)
   * - 6022: 体脂肪率 (%)
   */
  async getBodyComposition(from: Date, to: Date): Promise<TanitaApiResponse> {
    return this.request(
      "innerscan",
      formatTanitaDate(from),
      formatTanitaDate(to),
      INNERSCAN_TAGS,
    );
  }

  /**
   * 血圧データ取得（sphygmomanometer）
   * - 622E: 最高血圧 (mmHg)
   * - 622F: 最低血圧 (mmHg)
   * - 6230: 脈拍 (bpm)
   */
  async getBloodPressure(from: Date, to: Date): Promise<TanitaApiResponse> {
    return this.request(
      "sphygmomanometer",
      formatTanitaDate(from),
      formatTanitaDate(to),
      SPHYGMOMANOMETER_TAGS,
    );
  }

  /**
   * 歩数データ取得（pedometer）
   * - 6331: 歩数
   */
  async getSteps(from: Date, to: Date): Promise<TanitaApiResponse> {
    return this.request(
      "pedometer",
      formatTanitaDate(from),
      formatTanitaDate(to),
      PEDOMETER_TAGS,
    );
  }
}
