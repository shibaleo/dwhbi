import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupLogger } from "./logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("should respect log level", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = setupLogger("test", "warn");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    // Only warn and error should be logged
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });
});
