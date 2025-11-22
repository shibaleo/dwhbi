// test/fitbit/api.test.ts
// api.ts のヘルパー関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  formatFitbitDate,
  parseFitbitDate,
} from "../../src/services/fitbit/api.ts";

// ============================================================
// formatFitbitDate
// ============================================================

Deno.test("formatFitbitDate: 基本的な変換", () => {
  const date = new Date("2025-01-15T00:00:00Z");
  const result = formatFitbitDate(date);

  // YYYY-MM-DD形式
  assertEquals(result, "2025-01-15");
});

Deno.test("formatFitbitDate: 月と日のゼロパディング", () => {
  const date = new Date("2025-01-05T00:00:00Z");
  const result = formatFitbitDate(date);

  assertEquals(result, "2025-01-05");
});

Deno.test("formatFitbitDate: 12月31日", () => {
  const date = new Date("2025-12-31T00:00:00Z");
  const result = formatFitbitDate(date);

  assertEquals(result, "2025-12-31");
});

// ============================================================
// parseFitbitDate
// ============================================================

Deno.test("parseFitbitDate: 基本的な変換", () => {
  const result = parseFitbitDate("2025-01-15");

  assertEquals(result.getUTCFullYear(), 2025);
  assertEquals(result.getUTCMonth(), 0); // 0-indexed
  assertEquals(result.getUTCDate(), 15);
  assertEquals(result.getUTCHours(), 0);
  assertEquals(result.getUTCMinutes(), 0);
});

Deno.test("parseFitbitDate: 年末", () => {
  const result = parseFitbitDate("2025-12-31");

  assertEquals(result.getUTCFullYear(), 2025);
  assertEquals(result.getUTCMonth(), 11); // 12月 (0-indexed)
  assertEquals(result.getUTCDate(), 31);
});

Deno.test("parseFitbitDate: うるう年2月29日", () => {
  const result = parseFitbitDate("2024-02-29");

  assertEquals(result.getUTCFullYear(), 2024);
  assertEquals(result.getUTCMonth(), 1); // 2月 (0-indexed)
  assertEquals(result.getUTCDate(), 29);
});
