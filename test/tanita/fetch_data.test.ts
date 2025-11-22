// test/tanita/fetch_data.test.ts
// fetch_data.ts の純粋関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { generatePeriods } from "../../src/services/tanita/fetch_data.ts";

// ============================================================
// generatePeriods
// ============================================================

Deno.test("generatePeriods: 90日以内は1チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-03-01"); // 59日間

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 1);
  assertEquals(periods[0].from.toISOString().split("T")[0], "2025-01-01");
  assertEquals(periods[0].to.toISOString().split("T")[0], "2025-03-01");
});

Deno.test("generatePeriods: ちょうど90日は1チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-03-31"); // 89日間（1/1から3/31）

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 1);
});

Deno.test("generatePeriods: 91日以上は複数チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-05-01"); // 120日間

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 2);
  // 1チャンク目: 1/1 〜 3/31 (89日)
  assertEquals(periods[0].from.toISOString().split("T")[0], "2025-01-01");
  assertEquals(periods[0].to.toISOString().split("T")[0], "2025-03-31");
  // 2チャンク目: 4/1 〜 5/1
  assertEquals(periods[1].from.toISOString().split("T")[0], "2025-04-01");
  assertEquals(periods[1].to.toISOString().split("T")[0], "2025-05-01");
});

Deno.test("generatePeriods: 180日は2チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-06-29"); // 180日目（1/1が1日目）

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 2);
});

Deno.test("generatePeriods: 1年は5チャンク", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-12-31"); // 364日

  const periods = generatePeriods(startDate, endDate);

  // 90日 × 4 = 360日、残り4日で5チャンク
  assertEquals(periods.length, 5);
});

Deno.test("generatePeriods: 同日は1チャンク", () => {
  const startDate = new Date("2025-01-15");
  const endDate = new Date("2025-01-15");

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 1);
  assertEquals(periods[0].from.toISOString().split("T")[0], "2025-01-15");
  assertEquals(periods[0].to.toISOString().split("T")[0], "2025-01-15");
});

Deno.test("generatePeriods: 1日間は1チャンク", () => {
  const startDate = new Date("2025-01-15");
  const endDate = new Date("2025-01-16");

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 1);
});

Deno.test("generatePeriods: チャンクが連続している（隙間がない）", () => {
  const startDate = new Date("2025-01-01");
  const endDate = new Date("2025-07-01"); // 181日

  const periods = generatePeriods(startDate, endDate);

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

  const periods = generatePeriods(startDate, endDate);
  const lastPeriod = periods[periods.length - 1];

  assertEquals(lastPeriod.to.toISOString().split("T")[0], "2025-04-15");
});

Deno.test("generatePeriods: 年をまたぐ期間", () => {
  const startDate = new Date("2024-11-01");
  const endDate = new Date("2025-02-28"); // 約120日

  const periods = generatePeriods(startDate, endDate);

  assertEquals(periods.length, 2);
  // 年をまたいでも正しく処理される
  assertEquals(periods[0].from.getFullYear(), 2024);
  assertEquals(periods[1].to.getFullYear(), 2025);
});
