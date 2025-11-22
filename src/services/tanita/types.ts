// types.ts
// Tanita Health Planet API / DB 型定義

// ========== API レスポンス型 ==========

/** Tanita API 共通レスポンス */
export interface TanitaApiResponse {
  birth_date?: string;
  height?: string;
  sex?: string;
  data?: TanitaDataItem[];
}

/** Tanita API データアイテム（tag単位で返される） */
export interface TanitaDataItem {
  date: string; // YYYYMMDDHHmm形式
  keydata: string; // 測定値（文字列）
  model: string; // 測定機器コード
  tag: string; // 測定タグ（6021, 6022, 622E等）
}

/** OAuth2.0 トークンレスポンス */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // 秒
  token_type?: string;
}

// ========== DB レコード型 ==========

/** tanita.tokens テーブル */
export interface DbToken {
  id: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string; // ISO8601
  scope?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
  last_refreshed_at?: string;
}

/** tanita.body_composition テーブル */
export interface DbBodyComposition {
  id?: string;
  measured_at: string; // ISO8601
  weight?: number;
  body_fat_percent?: number;
  model?: string;
  synced_at?: string;
}

/** tanita.blood_pressure テーブル */
export interface DbBloodPressure {
  id?: string;
  measured_at: string; // ISO8601
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  model?: string;
  synced_at?: string;
}

/** tanita.steps テーブル */
export interface DbSteps {
  id?: string;
  measured_at: string; // ISO8601
  steps?: number;
  model?: string;
  synced_at?: string;
}

// ========== 設定・オプション型 ==========

/** 認証オプション */
export interface AuthOptions {
  forceRefresh?: boolean;
  thresholdDays?: number; // デフォルト: 7
}

/** データ取得オプション */
export interface FetchOptions {
  startDate?: Date;
  endDate?: Date;
}

/** 同期結果 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: {
    bodyComposition: number;
    bloodPressure: number;
    steps: number;
  };
  errors: string[];
  elapsedSeconds: number;
}

/** 取得データ（fetch_data.tsの出力） */
export interface TanitaData {
  bodyComposition: TanitaDataItem[];
  bloodPressure: TanitaDataItem[];
  steps: TanitaDataItem[];
}

// ========== タグ定数 ==========

export const TAGS = {
  // innerscan
  WEIGHT: "6021",
  BODY_FAT_PERCENT: "6022",
  // sphygmomanometer
  SYSTOLIC: "622E",
  DIASTOLIC: "622F",
  PULSE: "6230",
  // pedometer
  STEPS: "6331",
} as const;

export const INNERSCAN_TAGS = `${TAGS.WEIGHT},${TAGS.BODY_FAT_PERCENT}`;
export const SPHYGMOMANOMETER_TAGS =
  `${TAGS.SYSTOLIC},${TAGS.DIASTOLIC},${TAGS.PULSE}`;
export const PEDOMETER_TAGS = TAGS.STEPS;
