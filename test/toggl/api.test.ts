// test/toggl/api.test.ts
// api.ts のヘルパー関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { formatTogglDate } from "../../src/services/toggl/api.ts";
import { getDateRange } from "../../src/services/toggl/fetch_data.ts";

// ============================================================
// formatDate
// ============================================================

Deno.test("formatTogglDate: 基本的な変換", () => {
  const date = new Date("2025-01-15T00:00:00Z");
  const result = formatTogglDate(date);

  assertEquals(result, "2025-01-15");
});

Deno.test("formatTogglDate: 月と日のゼロパディング", () => {
  const date = new Date("2025-01-05T00:00:00Z");
  const result = formatTogglDate(date);

  assertEquals(result, "2025-01-05");
});

Deno.test("formatTogglDate: 12月31日", () => {
  const date = new Date("2025-12-31T00:00:00Z");
  const result = formatTogglDate(date);

  assertEquals(result, "2025-12-31");
});

Deno.test("formatTogglDate: 年初", () => {
  const date = new Date("2025-01-01T00:00:00Z");
  const result = formatTogglDate(date);

  assertEquals(result, "2025-01-01");
});

// ============================================================
// getDateRange
// ============================================================

Deno.test("getDateRange: 1日間", () => {
  // 基準日: 2025-01-15
  const baseDate = new Date("2025-01-15T12:00:00Z");
  const result = getDateRange(1, baseDate);

  // end = 2025-01-16（明日）
  // start = 2025-01-16 - 2 = 2025-01-14
  assertEquals(result.end, "2025-01-16");
  assertEquals(result.start, "2025-01-14");
});

Deno.test("getDateRange: 3日間（デフォルト）", () => {
  const baseDate = new Date("2025-01-15T12:00:00Z");
  const result = getDateRange(3, baseDate);

  // end = 2025-01-16
  // start = 2025-01-16 - 4 = 2025-01-12
  assertEquals(result.end, "2025-01-16");
  assertEquals(result.start, "2025-01-12");
});

Deno.test("getDateRange: 7日間", () => {
  const baseDate = new Date("2025-01-15T12:00:00Z");
  const result = getDateRange(7, baseDate);

  // end = 2025-01-16
  // start = 2025-01-16 - 8 = 2025-01-08
  assertEquals(result.end, "2025-01-16");
  assertEquals(result.start, "2025-01-08");
});

Deno.test("getDateRange: 月をまたぐ", () => {
  const baseDate = new Date("2025-02-02T12:00:00Z");
  const result = getDateRange(5, baseDate);

  // end = 2025-02-03
  // start = 2025-02-03 - 6 = 2025-01-28
  assertEquals(result.end, "2025-02-03");
  assertEquals(result.start, "2025-01-28");
});

Deno.test("getDateRange: 年をまたぐ", () => {
  const baseDate = new Date("2025-01-02T12:00:00Z");
  const result = getDateRange(5, baseDate);

  // end = 2025-01-03
  // start = 2025-01-03 - 6 = 2024-12-28
  assertEquals(result.end, "2025-01-03");
  assertEquals(result.start, "2024-12-28");
});

Deno.test("getDateRange: 30日間", () => {
  const baseDate = new Date("2025-01-31T12:00:00Z");
  const result = getDateRange(30, baseDate);

  // end = 2025-02-01
  // start = 2025-02-01 - 31 = 2025-01-01
  assertEquals(result.end, "2025-02-01");
  assertEquals(result.start, "2025-01-01");
});

Deno.test("getDateRange: 0日間（今日のみ）", () => {
  const baseDate = new Date("2025-01-15T12:00:00Z");
  const result = getDateRange(0, baseDate);

  // end = 2025-01-16
  // start = 2025-01-16 - 1 = 2025-01-15
  assertEquals(result.end, "2025-01-16");
  assertEquals(result.start, "2025-01-15");
});
