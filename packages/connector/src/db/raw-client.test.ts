import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertRaw, upsertRawBatch, type RawRecord } from "./raw-client.js";

// Mock pg module
vi.mock("pg", () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      Client: vi.fn(() => mockClient),
    },
  };
});

describe("raw-client", () => {
  beforeEach(() => {
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.clearAllMocks();
  });

  describe("upsertRaw", () => {
    it("should return zero counts for empty records", async () => {
      const result = await upsertRaw("test_table", []);

      expect(result).toEqual({
        table: "test_table",
        inserted: 0,
        updated: 0,
        total: 0,
      });
    });

    it("should upsert records and return counts", async () => {
      const records: RawRecord[] = [
        { sourceId: "1", data: { name: "test1" } },
        { sourceId: "2", data: { name: "test2" } },
      ];

      const result = await upsertRaw("test_table", records, "v1");

      expect(result).toEqual({
        table: "test_table",
        inserted: 2,
        updated: 0,
        total: 2,
      });
    });
  });

  describe("upsertRawBatch", () => {
    it("should return zero counts for empty records", async () => {
      const result = await upsertRawBatch("test_table", []);

      expect(result).toEqual({
        table: "test_table",
        inserted: 0,
        updated: 0,
        total: 0,
      });
    });

    it("should split large batches", async () => {
      const records: RawRecord[] = Array.from({ length: 2500 }, (_, i) => ({
        sourceId: String(i),
        data: { index: i },
      }));

      const result = await upsertRawBatch("test_table", records, "v1", 1000);

      expect(result.total).toBe(2500);
    });
  });
});
