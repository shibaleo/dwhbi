// test/tanita/api.test.ts
// api.ts のヘルパー関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  formatTanitaDate,
  parseTanitaDate,
} from "../../src/services/tanita/api.ts";

// ============================================================
// formatTanitaDate
// ============================================================

Deno.test("formatTanitaDate: 基本的な変換", () => {
  // 入力はローカルタイム（実行環境のタイムゾーン依存）
  const date = new Date(2025, 0, 15); // 2025-01-15 00:00:00 ローカル
  const result = formatTanitaDate(date);

  // YYYYMMDDHHmmss形式、時刻部分は000000
  assertEquals(result, "20250115000000");
});

Deno.test("formatTanitaDate: 月と日のゼロパディング", () => {
  const date = new Date(2025, 0, 5); // 2025-01-05
  const result = formatTanitaDate(date);

  assertEquals(result, "20250105000000");
});

Deno.test("formatTanitaDate: 12月31日", () => {
  const date = new Date(2025, 11, 31); // 2025-12-31
  const result = formatTanitaDate(date);

  assertEquals(result, "20251231000000");
});

// ============================================================
// parseTanitaDate (JST → UTC変換)
// ============================================================

Deno.test("parseTanitaDate: 基本的な変換（JST → UTC）", () => {
  // JST 2025-01-15 07:30 = UTC 2025-01-14 22:30
  const result = parseTanitaDate("202501150730");

  assertEquals(result.getUTCFullYear(), 2025);
  assertEquals(result.getUTCMonth(), 0);
  assertEquals(result.getUTCDate(), 14);
  assertEquals(result.getUTCHours(), 22);
  assertEquals(result.getUTCMinutes(), 30);
});

Deno.test("parseTanitaDate: 深夜0時（日付が前日になる）", () => {
  // JST 2025-01-15 00:00 = UTC 2025-01-14 15:00
  const result = parseTanitaDate("202501150000");

  assertEquals(result.getUTCDate(), 14);
  assertEquals(result.getUTCHours(), 15);
});

Deno.test("parseTanitaDate: JST朝9時（UTC同日0時）", () => {
  // JST 2025-01-15 09:00 = UTC 2025-01-15 00:00
  const result = parseTanitaDate("202501150900");

  assertEquals(result.getUTCDate(), 15);
  assertEquals(result.getUTCHours(), 0);
});

Deno.test("parseTanitaDate: JST午前3時（早朝のエッジケース）", () => {
  // JST 2025-01-15 03:00 = UTC 2025-01-14 18:00
  const result = parseTanitaDate("202501150300");

  assertEquals(result.getUTCDate(), 14);
  assertEquals(result.getUTCHours(), 18);
});

Deno.test("parseTanitaDate: JST夜23時（同日内）", () => {
  // JST 2025-01-15 23:00 = UTC 2025-01-15 14:00
  const result = parseTanitaDate("202501152300");

  assertEquals(result.getUTCDate(), 15);
  assertEquals(result.getUTCHours(), 14);
});

Deno.test("parseTanitaDate: 年越し（1月1日早朝）", () => {
  // JST 2025-01-01 02:00 = UTC 2024-12-31 17:00
  const result = parseTanitaDate("202501010200");

  assertEquals(result.getUTCFullYear(), 2024);
  assertEquals(result.getUTCMonth(), 11); // 12月 (0-indexed)
  assertEquals(result.getUTCDate(), 31);
  assertEquals(result.getUTCHours(), 17);
});

Deno.test("parseTanitaDate: うるう年2月29日", () => {
  // JST 2024-02-29 12:00 = UTC 2024-02-29 03:00
  const result = parseTanitaDate("202402291200");

  assertEquals(result.getUTCFullYear(), 2024);
  assertEquals(result.getUTCMonth(), 1); // 2月 (0-indexed)
  assertEquals(result.getUTCDate(), 29);
  assertEquals(result.getUTCHours(), 3);
});

Deno.test("parseTanitaDate: ISO文字列として有効", () => {
  const result = parseTanitaDate("202501150730");
  const isoString = result.toISOString();

  // ISO形式であること
  assertEquals(isoString, "2025-01-14T22:30:00.000Z");
});
