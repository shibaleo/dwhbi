// test/fitbit/fetch_data.test.ts
// fetch_data.ts の純粋関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  generateDateRange,
  generatePeriods,
} from "../../src/services/fitbit/fetch_data.ts";

// ============================================================
// generateDateRange
// ============================================================

Deno.test("generateDateRange: 1日間", () => {
  const startDate = new Date("2025-01-15");
  const endDate = new Date("2025-01-15");

  const dates = generateDateRange(startDate, endDate);

  assertEquals(dates.length, 1);
  assertEquals(dates[0].toISOString().split("T")[0], "2025-01-15");
});

Deno.test("generateDateRange: 7日間", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-01-07");

  const dates = generateDateRange(startDate, endDate);

  assertEquals(dates.length, 7);
  assertEquals(dates[0].toISOString().split("T")[0], "2025-01-01");
  assertEquals(dates[6].toISOString().split("T")[0], "2025-01-07");
});

Deno.test("generateDateRange: 月をまたぐ", () => {
  const startDate = new Date("2025-01-30");
  const endDate = new Date("2025-02-02");

  const dates = generateDateRange(startDate, endDate);

  assertEquals(dates.length, 4);
  assertEquals(dates[0].toISOString().split("T")[0], "2025-01-30");
  assertEquals(dates[3].toISOString().split("T")[0], "2025-02-02");
});

Deno.test("generateDateRange: 年をまたぐ", () => {
  const startDate = new Date("2024-12-30");
  const endDate = new Date("2025-01-02");

  const dates = generateDateRange(startDate, endDate);

  assertEquals(dates.length, 4);
  assertEquals(dates[0].toISOString().split("T")[0], "2024-12-30");
  assertEquals(dates[3].toISOString().split("T")[0], "2025-01-02");
});

// ============================================================
// generatePeriods
// ============================================================

Deno.test("generatePeriods: maxDays以内は1チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-01-15"); // 15日間

  const periods = generatePeriods(startDate, endDate, 90);

  assertEquals(periods.length, 1);
  assertEquals(periods[0].from.toISOString().split("T")[0], "2025-01-01");
  assertEquals(periods[0].to.toISOString().split("T")[0], "2025-01-15");
});

Deno.test("generatePeriods: Sleep API 90日チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-05-01"); // 約120日間

  const periods = generatePeriods(startDate, endDate, 90);

  assertEquals(periods.length, 2);
  // 1チャンク目: 1/1 〜 3/31 (89日)
  assertEquals(periods[0].from.toISOString().split("T")[0], "2025-01-01");
  // 2チャンク目: 最終チャンクは endDate で終わる
  assertEquals(periods[1].to.toISOString().split("T")[0], "2025-05-01");
});

Deno.test("generatePeriods: Temperature API 30日チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-03-01"); // 59日間

  const periods = generatePeriods(startDate, endDate, 30);

  assertEquals(periods.length, 2);
});

Deno.test("generatePeriods: 同日は1チャンク", () => {
  const startDate = new Date("2025-01-15");
  const endDate = new Date("2025-01-15");

  const periods = generatePeriods(startDate, endDate, 100);

  assertEquals(periods.length, 1);
  assertEquals(periods[0].from.toISOString().split("T")[0], "2025-01-15");
  assertEquals(periods[0].to.toISOString().split("T")[0], "2025-01-15");
});

Deno.test("generatePeriods: チャンクが連続している（隙間がない）", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-06-01"); // 約150日

  const periods = generatePeriods(startDate, endDate, 100);

  // 各チャンクの終了日の翌日が次のチャンクの開始日
  for (let i = 0; i < periods.length - 1; i++) {
    const currentEnd = new Date(periods[i].to);
    const nextStart = new Date(periods[i + 1].from);
    
    currentEnd.setDate(currentEnd.getDate() + 1);
    assertEquals(
      currentEnd.toISOString().split("T")[0],
      nextStart.toISOString().split("T")[0],
      `チャンク${i}と${i + 1}の間に隙間がある`
    );
  }
});

Deno.test("generatePeriods: 最終チャンクはendDateで終わる", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-04-15"); // 104日

  const periods = generatePeriods(startDate, endDate, 100);
  const lastPeriod = periods[periods.length - 1];

  assertEquals(lastPeriod.to.toISOString().split("T")[0], "2025-04-15");
});
