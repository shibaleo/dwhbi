/**
 * Logger utility
 *
 * Console-based logging with timestamp and log levels.
 *
 * Log levels:
 * - debug: Detailed internal state (credentials loading, API requests, etc.)
 * - info: Normal operation progress (sync start/end, record counts)
 * - warn: Recoverable issues (rate limits, partial failures)
 * - error: Fatal errors that stop execution
 *
 * Usage:
 * - CLI: --log-level debug|info|warn|error
 * - Library: setLogLevel("warn") before calling sync functions
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default to "info" level for development visibility.
// DESIGN DECISION: We intentionally do NOT auto-detect environment (VITEST, NODE_ENV, CI).
// Explicit flag is required so that future developers always know why the log level is set.
// Production environments should use --log-level warn to minimize output.
// If you're wondering "why is logging behaving this way?", check the CLI --log-level flag
// or setLogLevel() call in your code.
let currentLevel: LogLevel = "info";
let levelHasBeenSet = false;

function formatTimestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(level: LogLevel, name: string, message: string): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) {
    return;
  }

  const timestamp = formatTimestamp();
  const levelStr = level.toUpperCase().padEnd(5);
  console.log(`[${timestamp}] ${levelStr} [${name}] ${message}`);
}

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Set global log level.
 * Call this early in your application (e.g., in CLI before sync).
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  levelHasBeenSet = true;
}

/**
 * Get current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Check if log level has been explicitly set.
 */
export function isLogLevelSet(): boolean {
  return levelHasBeenSet;
}

/**
 * Create a logger instance for a specific module.
 */
export function setupLogger(name: string): Logger {
  return {
    debug: (message: string) => log("debug", name, message),
    info: (message: string) => log("info", name, message),
    warn: (message: string) => log("warn", name, message),
    error: (message: string) => log("error", name, message),
  };
}

// Default logger
const defaultLogger = setupLogger("connector");

export const info = (message: string): void => defaultLogger.info(message);
export const error = (message: string): void => defaultLogger.error(message);
export const warn = (message: string): void => defaultLogger.warn(message);
export const debug = (message: string): void => defaultLogger.debug(message);
