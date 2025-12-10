import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupLogger, setLogLevel } from "./logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset to info level for most tests (default is warn in production)
    setLogLevel("info");
  });

  it("should create a logger with all methods", () => {
    const logger = setupLogger("test");

    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
  });

  it("should log messages with correct format", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = setupLogger("test-module");

    logger.info("test message");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logOutput = consoleSpy.mock.calls[0][0] as string;
    expect(logOutput).toContain("INFO");
    expect(logOutput).toContain("[test-module]");
    expect(logOutput).toContain("test message");
  });

  it("should respect log level (warn)", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Set log level to warn
    setLogLevel("warn");
    const logger = setupLogger("test");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    // Only warn and error should be logged
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("should respect log level (debug)", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Set log level to debug
    setLogLevel("debug");
    const logger = setupLogger("test");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    // All 4 levels should be logged
    expect(consoleSpy).toHaveBeenCalledTimes(4);
  });
});
