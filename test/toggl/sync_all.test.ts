// test/toggl/sync_all.test.ts
// splitDateRange 関数の単体テスト
//
// 実行方法:
//   deno test test/toggl/sync_all.test.ts

import { assertEquals } from "jsr:@std/assert";
import { splitDateRange, CHUNK_MONTHS } from "../../src/services/toggl/fetch_data.ts";

// =============================================================================
// splitDateRange Tests
// =============================================================================

Deno.test("splitDateRange: 2か月間 → 1チャンク", () => {
  const start = new Date("2024-01-01");
  const end = new Date("2024-02-28");
  const chunks = splitDateRange(start, end, 2);

  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].start, "2024-01-01");
  assertEquals(chunks[0].end, "2024-02-28");
});

Deno.test("splitDateRange: 4か月間 → 2チャンク", () => {
  const start = new Date("2024-01-01");
  const end = new Date("2024-04-30");
  const chunks = splitDateRange(start, end, 2);

  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].start, "2024-01-01");
  assertEquals(chunks[0].end, "2024-03-01");
  assertEquals(chunks[1].start, "2024-03-02");
  assertEquals(chunks[1].end, "2024-04-30");
});

Deno.test("splitDateRange: 1年間 → 1チャンク（12か月単位）", () => {
  const start = new Date("2024-01-01");
  const end = new Date("2024-12-31");
  const chunks = splitDateRange(start, end, 12);

  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].start, "2024-01-01");
  assertEquals(chunks[0].end, "2024-12-31");
});

Deno.test("splitDateRange: 2年間 → 2チャンク（12か月単位）", () => {
  const start = new Date("2023-01-01");
  const end = new Date("2024-12-31");
  const chunks = splitDateRange(start, end, 12);

  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].start, "2023-01-01");
  assertEquals(chunks[1].end, "2024-12-31");
});

Deno.test("splitDateRange: 年またぎ（11月〜2月）→ 1チャンク", () => {
  const start = new Date("2023-11-01");
  const end = new Date("2024-02-29");
  const chunks = splitDateRange(start, end, 12);

  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].start, "2023-11-01");
  assertEquals(chunks[0].end, "2024-02-29");
});

Deno.test("splitDateRange: 1か月未満 → 1チャンク", () => {
  const start = new Date("2024-01-15");
  const end = new Date("2024-01-31");
  const chunks = splitDateRange(start, end, 2);

  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].start, "2024-01-15");
  assertEquals(chunks[0].end, "2024-01-31");
});

Deno.test("splitDateRange: デフォルトchunkMonths = CHUNK_MONTHS (12)", () => {
  const start = new Date("2024-01-01");
  const end = new Date("2024-12-31");
  
  // 引数なしで呼び出し
  const chunks = splitDateRange(start, end);

  assertEquals(chunks.length, 1);
  assertEquals(CHUNK_MONTHS, 12);
});

Deno.test("splitDateRange: 開始日 = 終了日 → 0チャンク", () => {
  const start = new Date("2024-01-01");
  const end = new Date("2024-01-01");
  const chunks = splitDateRange(start, end, 2);

  // start < end でないためループに入らない
  assertEquals(chunks.length, 0);
});

Deno.test("splitDateRange: カスタムchunkMonths（3か月）", () => {
  const start = new Date("2024-01-01");
  const end = new Date("2024-09-30");
  const chunks = splitDateRange(start, end, 3);

  assertEquals(chunks.length, 3);
});
