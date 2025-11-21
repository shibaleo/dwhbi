/**
 * レート制限エラーや認証エラーをチェック
 * これらのエラーはリトライしても無意味なので即座に諦める
 */
export function isNonRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // 402: Payment Required (レート制限)
  // 429: Too Many Requests (レート制限)
  // 401: Unauthorized (認証エラー)
  // 403: Forbidden (認証エラー)
  return message.includes('402') || 
         message.includes('429') ||
         message.includes('401') ||
         message.includes('403') ||
         message.includes('payment required') ||
         message.includes('rate limit') ||
         message.includes('hourly limit');
}

/**
 * エラーメッセージを整形
 */
export function formatTogglError(error: Error, context: string): string {
  if (isNonRetryableError(error)) {
    return `Toggl API ${context} failed (rate limit or auth error - no retry): ${error.message}`;
  }
  return error.message;
}