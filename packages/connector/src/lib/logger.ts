/**
 * Logger utility
 *
 * Simple console-based logging with timestamp and log levels.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

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

export function setupLogger(name: string, level?: LogLevel): Logger {
  if (level) {
    currentLevel = level;
  }

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
