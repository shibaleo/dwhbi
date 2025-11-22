/**
 * 共通ログユーティリティ
 *
 * シンプルで統一されたログ出力を提供
 * GitHub Actions等の環境でも正しく表示される
 */

// =============================================================================
// Log Functions
// =============================================================================

export function info(message: string): void {
  console.log(`[INFO]     ${message}`);
}

export function success(message: string): void {
  console.log(`[SUCCESS]  ${message}`);
}

export function error(message: string): void {
  console.error(`[ERROR]    ${message}`);
}

export function warn(message: string): void {
  console.log(`[WARN]     ${message}`);
}

export function debug(message: string): void {
  console.log(`[DEBUG]    ${message}`);
}

export function section(title: string): void {
  console.log(`\n[SECTION]  ${title}`);
}

export function separator(char: string = "=", length: number = 60): void {
  console.log(char.repeat(length));
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * 文字列の末尾N文字以外をマスク
 * 機密情報（メールアドレス、APIキーなど）の表示用
 */
export function mask(str: string, visibleChars: number = 3): string {
  if (str.length <= visibleChars) return str;
  return "*".repeat(str.length - visibleChars) + str.slice(-visibleChars);
}

/**
 * 同期開始ヘッダーを表示
 */
export function syncStart(serviceName: string, days?: number): void {
  separator();
  if (days !== undefined) {
    console.log(`${serviceName} Sync Start (${days} days)`);
  } else {
    console.log(`${serviceName} Sync Start`);
  }
  separator();
}

/**
 * 同期完了フッターを表示
 */
export function syncEnd(isSuccess: boolean, elapsedSeconds?: number): void {
  console.log("");
  separator();
  if (isSuccess) {
    const timeStr = elapsedSeconds !== undefined ? ` (${elapsedSeconds.toFixed(1)}s)` : "";
    console.log(`[SUCCESS]  Sync completed${timeStr}`);
  } else {
    console.log(`[ERROR]    Sync failed`);
  }
  separator();
}

/**
 * テスト/チェック用ヘッダーを表示
 */
export function header(title: string, options?: Record<string, unknown>): void {
  separator();
  console.log(title);
  if (options) {
    const optStr = Object.entries(options)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    console.log(`Options: ${optStr}`);
  }
  separator();
}

/**
 * テスト/チェック用フッターを表示
 */
export function footer(isSuccess: boolean): void {
  console.log("");
  separator();
  if (isSuccess) {
    console.log(`[SUCCESS]  All checks passed`);
  } else {
    console.log(`[ERROR]    Check failed`);
  }
  separator();
}

/**
 * 期間情報を表示
 */
export function period(startDate: string, endDate: string, extraInfo?: string): void {
  info(`Period: ${startDate} - ${endDate}`);
  if (extraInfo) {
    info(extraInfo);
  }
}

/**
 * 取得結果を表示
 */
export function fetched(dataType: string, count: number, unit: string = "records"): void {
  info(`${dataType}: ${count} ${unit}`);
}

/**
 * 保存結果を表示
 */
export function saved(dataType: string, count: number): void {
  if (count > 0) {
    success(`${dataType}: ${count} saved`);
  } else {
    info(`${dataType}: 0 records`);
  }
}
