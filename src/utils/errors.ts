/**
 * 共通エラークラス
 *
 * 各サービスのレート制限エラー等の基底クラスを提供
 */

// =============================================================================
// Base Error Classes
// =============================================================================

/**
 * レート制限エラー基底クラス
 *
 * 各サービスのレート制限エラーはこのクラスを継承する
 */
export class RateLimitError extends Error {
  /** リセットまでの待機秒数 */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message?: string) {
    super(message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * クォータ超過エラー基底クラス
 *
 * API使用量制限（時間/日/月単位）を超えた場合のエラー
 */
export class QuotaExceededError extends Error {
  /** リセットまでの待機秒数 */
  readonly resetsInSeconds: number;

  constructor(resetsInSeconds: number, message?: string) {
    super(message ?? `Quota exceeded. Resets in ${resetsInSeconds} seconds.`);
    this.name = "QuotaExceededError";
    this.resetsInSeconds = resetsInSeconds;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * RateLimitError かどうかを判定
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

/**
 * QuotaExceededError かどうかを判定
 */
export function isQuotaExceededError(error: unknown): error is QuotaExceededError {
  return error instanceof QuotaExceededError;
}

/**
 * リトライ可能なエラーかどうかを判定
 */
export function isRetryableError(error: unknown): error is RateLimitError | QuotaExceededError {
  return isRateLimitError(error) || isQuotaExceededError(error);
}

/**
 * リトライ待機時間を取得（秒）
 */
export function getRetryAfterSeconds(error: unknown): number | null {
  if (error instanceof RateLimitError) {
    return error.retryAfterSeconds;
  }
  if (error instanceof QuotaExceededError) {
    return error.resetsInSeconds;
  }
  return null;
}
