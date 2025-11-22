/**
 * テスト用ログユーティリティ
 *
 * テスト実行時のログであることが明確にわかるプレフィックスを付与
 */

// =============================================================================
// Log Functions (Test Mode)
// =============================================================================

export function info(message: string): void {
  console.log(`[TEST INFO]     ${message}`);
}

export function success(message: string): void {
  console.log(`[TEST SUCCESS]  ${message}`);
}

export function error(message: string): void {
  console.error(`[TEST ERROR]    ${message}`);
}

export function warn(message: string): void {
  console.log(`[TEST WARN]     ${message}`);
}

export function debug(message: string): void {
  console.log(`[TEST DEBUG]    ${message}`);
}

export function section(title: string): void {
  console.log(`\n[TEST SECTION]  ${title}`);
}

export function separator(char: string = "=", length: number = 60): void {
  console.log(char.repeat(length));
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * 文字列の末尾N文字以外をマスク
 */
export function mask(str: string, visibleChars: number = 3): string {
  if (str.length <= visibleChars) return str;
  return "*".repeat(str.length - visibleChars) + str.slice(-visibleChars);
}

/**
 * テスト用ヘッダーを表示
 */
export function header(title: string, options?: Record<string, unknown>): void {
  separator();
  console.log(`[TEST] ${title}`);
  if (options) {
    const optStr = Object.entries(options)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    console.log(`[TEST] Options: ${optStr}`);
  }
  separator();
}

/**
 * テスト用フッターを表示
 */
export function footer(isSuccess: boolean): void {
  console.log("");
  separator();
  if (isSuccess) {
    console.log(`[TEST SUCCESS]  All checks passed`);
  } else {
    console.log(`[TEST ERROR]    Check failed`);
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
