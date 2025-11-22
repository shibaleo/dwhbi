/**
 * Fitbit Web API クライアント
 */
import type {
  FitbitApiActivityDailySummary,
  FitbitApiAzmResponse,
  FitbitApiBreathingRateResponse,
  FitbitApiCardioScoreResponse,
  FitbitApiHeartRateTimeSeriesResponse,
  FitbitApiHrvResponse,
  FitbitApiSleepResponse,
  FitbitApiSpo2Response,
  FitbitApiTemperatureSkinResponse,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const BASE_URL = "https://api.fitbit.com";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * DateをFitbit API形式（YYYY-MM-DD）に変換
 */
export function formatFitbitDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * YYYY-MM-DD形式の文字列をDateに変換
 */
export function parseFitbitDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

// =============================================================================
// API Client
// =============================================================================

export class FitbitAPI {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * 汎用GETリクエスト
   */
  private async request<T>(endpoint: string): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Accept": "application/json",
        "Accept-Language": "ja_JP",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Fitbit API エラー: ${response.status} - ${errorText}`,
      );
    }

    return await response.json();
  }

  // ===========================================================================
  // Sleep API
  // ===========================================================================

  /**
   * 睡眠データ取得（日付範囲）
   * 最大100日間
   */
  async getSleepByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiSleepResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(`/1.2/user/-/sleep/date/${start}/${end}.json`);
  }

  /**
   * 睡眠データ取得（単日）
   */
  async getSleepByDate(date: Date): Promise<FitbitApiSleepResponse> {
    const dateStr = formatFitbitDate(date);
    return this.request(`/1.2/user/-/sleep/date/${dateStr}.json`);
  }

  // ===========================================================================
  // Activity API
  // ===========================================================================

  /**
   * 日次活動サマリー取得
   */
  async getActivityDailySummary(date: Date): Promise<FitbitApiActivityDailySummary> {
    const dateStr = formatFitbitDate(date);
    return this.request(`/1/user/-/activities/date/${dateStr}.json`);
  }

  // ===========================================================================
  // Heart Rate API
  // ===========================================================================

  /**
   * 心拍数Time Series取得（日付範囲）
   */
  async getHeartRateByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiHeartRateTimeSeriesResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(
      `/1/user/-/activities/heart/date/${start}/${end}.json`,
    );
  }

  /**
   * 心拍数Intraday取得（1日分、1分粒度）
   */
  async getHeartRateIntraday(date: Date): Promise<FitbitApiHeartRateTimeSeriesResponse> {
    const dateStr = formatFitbitDate(date);
    return this.request(
      `/1/user/-/activities/heart/date/${dateStr}/1d/1min.json`,
    );
  }

  // ===========================================================================
  // HRV API
  // ===========================================================================

  /**
   * HRV日次サマリー取得（日付範囲）
   */
  async getHrvByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiHrvResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(`/1/user/-/hrv/date/${start}/${end}.json`);
  }

  /**
   * HRV Intraday取得（1日分）
   */
  async getHrvIntraday(date: Date): Promise<FitbitApiHrvResponse> {
    const dateStr = formatFitbitDate(date);
    return this.request(`/1/user/-/hrv/date/${dateStr}/all.json`);
  }

  // ===========================================================================
  // SpO2 API
  // ===========================================================================

  /**
   * SpO2日次サマリー取得（単日）
   */
  async getSpo2ByDate(date: Date): Promise<FitbitApiSpo2Response> {
    const dateStr = formatFitbitDate(date);
    return this.request(`/1/user/-/spo2/date/${dateStr}.json`);
  }

  /**
   * SpO2日次サマリー取得（日付範囲）
   */
  async getSpo2ByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiSpo2Response[]> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(`/1/user/-/spo2/date/${start}/${end}.json`);
  }

  // ===========================================================================
  // Breathing Rate API
  // ===========================================================================

  /**
   * 呼吸数日次サマリー取得（日付範囲）
   */
  async getBreathingRateByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiBreathingRateResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(`/1/user/-/br/date/${start}/${end}.json`);
  }

  // ===========================================================================
  // Cardio Score (VO2 Max) API
  // ===========================================================================

  /**
   * VO2 Max日次サマリー取得（日付範囲）
   */
  async getCardioScoreByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiCardioScoreResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(`/1/user/-/cardioscore/date/${start}/${end}.json`);
  }

  // ===========================================================================
  // Temperature API
  // ===========================================================================

  /**
   * 皮膚温度日次サマリー取得（日付範囲、最大30日）
   */
  async getTemperatureSkinByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiTemperatureSkinResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(`/1/user/-/temp/skin/date/${start}/${end}.json`);
  }

  // ===========================================================================
  // Active Zone Minutes API
  // ===========================================================================

  /**
   * AZM日次サマリー取得（日付範囲）
   */
  async getAzmByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitApiAzmResponse> {
    const start = formatFitbitDate(startDate);
    const end = formatFitbitDate(endDate);
    return this.request(
      `/1/user/-/activities/active-zone-minutes/date/${start}/${end}.json`,
    );
  }
}
