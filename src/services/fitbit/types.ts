// types.ts - Fitbit関連の型定義

export interface DateRange {
  start: string; // YYYY-MM-DD形式
  end: string;   // YYYY-MM-DD形式
}

// Activity詳細データの型
export interface ActivityData {
  steps?: any[];
  distance?: any[];
  calories?: any[];
  floors?: any[];
  elevation?: any[];
  minutesSedentary?: any[];
  minutesLightlyActive?: any[];
  minutesFairlyActive?: any[];
  minutesVeryActive?: any[];
}

// 日付ごとのFitbitデータ（内部使用）
export interface DailyFitbitData {
  date: string;
  sleep: any[];
  heartRate: any[];
  activity: ActivityData;
  bodyWeight: any[];
  bodyFat: any[];
  spo2: any[];
}

// Fitbit APIから取得した全スコープデータ
export interface FitbitAllScopeData {
  dateRange: DateRange;
  fetchedAt: string; // ISO 8601形式のタイムスタンプ
  sleep: any[];
  heartRate: any[];
  activity: ActivityData;  // 変更: any[] → ActivityData
  bodyWeight: any[];
  bodyFat: any[];
  spo2: any[];
}

// キャッシュファイルの構造
export interface CachedAllScopeData {
  dateRange: DateRange;
  fetchedAt: string;
  data: FitbitAllScopeData;
}

// Fitbitトークン情報（refresh_fitbit_token.tsから使用）
export interface FitbitTokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}