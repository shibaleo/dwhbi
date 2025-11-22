/**
 * Tanita Health Planet 型定義
 *
 * API レスポンス型、DB テーブル型、同期関連型
 */

// =============================================================================
// Tanita API Response Types
// =============================================================================

/** Tanita API 共通レスポンス */
export interface TanitaApiResponse {
  birth_date?: string;
  height?: string;
  sex?: string;
  data?: TanitaApiDataItem[];
}

/** Tanita API データアイテム（tag単位で返される） */
export interface TanitaApiDataItem {
  date: string; // YYYYMMDDHHmm形式
  keydata: string; // 測定値（文字列）
  model: string; // 測定機器コード
  tag: string; // 測定タグ（6021, 6022, 622E等）
}

// =============================================================================
// Auth Types
// =============================================================================

/** OAuth2.0 トークンレスポンス */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // 秒
  token_type?: string;
}

/** 認証オプション */
export interface AuthOptions {
  forceRefresh?: boolean;
  thresholdDays?: number; // デフォルト: 7
}

// =============================================================================
// Database Table Types (tanita schema)
// =============================================================================

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

// =============================================================================
// Fetch Options & Data Types
// =============================================================================

/** データ取得オプション */
export interface FetchOptions {
  startDate?: Date;
  endDate?: Date;
}

/** 取得データ（fetch_data.ts の出力） */
export interface TanitaData {
  bodyComposition: TanitaApiDataItem[];
  bloodPressure: TanitaApiDataItem[];
  steps: TanitaApiDataItem[];
}

// =============================================================================
// Sync Result Types
// =============================================================================

/** 同期統計 */
export interface SyncStats {
  bodyComposition: number;
  bloodPressure: number;
  steps: number;
}

/** 同期結果 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: SyncStats;
  errors: string[];
  elapsedSeconds: number;
}

// =============================================================================
// Constants
// =============================================================================

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
export const SPHYGMOMANOMETER_TAGS = `${TAGS.SYSTOLIC},${TAGS.DIASTOLIC},${TAGS.PULSE}`;
export const PEDOMETER_TAGS = TAGS.STEPS;

// =============================================================================
// Type Aliases (後方互換性のため)
// =============================================================================

/** @deprecated Use TanitaApiDataItem instead */
export type TanitaDataItem = TanitaApiDataItem;
