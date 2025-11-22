// test/tanita/write_db.test.ts
// write_db.ts の変換関数に対する単体テスト

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  toDbBodyComposition,
  toDbBloodPressure,
  toDbSteps,
} from "../../src/services/tanita/write_db.ts";

import type { TanitaDataItem } from "../../src/services/tanita/types.ts";

// ============================================================
// toDbBodyComposition
// ============================================================

Deno.test("toDbBodyComposition: 体重と体脂肪率の変換", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "62.5", model: "01000089", tag: "6021" },
    { date: "202501150730", keydata: "16.5", model: "01000089", tag: "6022" },
  ];

  const result = toDbBodyComposition(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].weight, 62.5);
  assertEquals(result[0].body_fat_percent, 16.5);
  assertEquals(result[0].model, "01000089");
  assertExists(result[0].measured_at);
});

Deno.test("toDbBodyComposition: 複数の測定時刻をグループ化", () => {
  const input: TanitaDataItem[] = [
    // 1回目の測定
    { date: "202501150730", keydata: "62.5", model: "01000089", tag: "6021" },
    { date: "202501150730", keydata: "16.5", model: "01000089", tag: "6022" },
    // 2回目の測定
    { date: "202501160800", keydata: "62.0", model: "01000089", tag: "6021" },
    { date: "202501160800", keydata: "16.0", model: "01000089", tag: "6022" },
  ];

  const result = toDbBodyComposition(input);

  assertEquals(result.length, 2);
});

Deno.test("toDbBodyComposition: 手入力のみ（model=00000000）は初期値として保持", () => {
  // 手入力データのみの場合、初期化時に設定された00000000がそのまま残る
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "62.5", model: "00000000", tag: "6021" },
  ];

  const result = toDbBodyComposition(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].weight, 62.5);
  assertEquals(result[0].model, "00000000");
});

Deno.test("toDbBodyComposition: 手入力+実機データの混合は実機のmodelが優先", () => {
  // 同一時刻に手入力と実機データが混在する場合、00000000以外のmodelで上書きされる
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "62.5", model: "00000000", tag: "6021" },
    { date: "202501150730", keydata: "16.5", model: "01000089", tag: "6022" },
  ];

  const result = toDbBodyComposition(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].weight, 62.5);
  assertEquals(result[0].body_fat_percent, 16.5);
  // 実機のmodelが優先される
  assertEquals(result[0].model, "01000089");
});

Deno.test("toDbBodyComposition: 体重のみ（体脂肪率なし）", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "62.5", model: "01000089", tag: "6021" },
  ];

  const result = toDbBodyComposition(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].weight, 62.5);
  assertEquals(result[0].body_fat_percent, undefined);
});

Deno.test("toDbBodyComposition: 空配列", () => {
  const result = toDbBodyComposition([]);
  assertEquals(result.length, 0);
});

Deno.test("toDbBodyComposition: 未知のtagは無視される", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "62.5", model: "01000089", tag: "6021" },
    { date: "202501150730", keydata: "999", model: "01000089", tag: "9999" }, // 未知のtag
  ];

  const result = toDbBodyComposition(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].weight, 62.5);
  assertEquals(result[0].body_fat_percent, undefined); // 9999は無視される
});

// ============================================================
// toDbBloodPressure
// ============================================================

Deno.test("toDbBloodPressure: 血圧と脈拍の変換", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "120", model: "01000078", tag: "622E" },
    { date: "202501150730", keydata: "80", model: "01000078", tag: "622F" },
    { date: "202501150730", keydata: "72", model: "01000078", tag: "6230" },
  ];

  const result = toDbBloodPressure(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].systolic, 120);
  assertEquals(result[0].diastolic, 80);
  assertEquals(result[0].pulse, 72);
  assertEquals(result[0].model, "01000078");
  assertExists(result[0].measured_at);
});

Deno.test("toDbBloodPressure: 複数の測定時刻をグループ化", () => {
  const input: TanitaDataItem[] = [
    // 朝の測定
    { date: "202501150730", keydata: "120", model: "01000078", tag: "622E" },
    { date: "202501150730", keydata: "80", model: "01000078", tag: "622F" },
    { date: "202501150730", keydata: "72", model: "01000078", tag: "6230" },
    // 夜の測定
    { date: "202501152100", keydata: "115", model: "01000078", tag: "622E" },
    { date: "202501152100", keydata: "75", model: "01000078", tag: "622F" },
    { date: "202501152100", keydata: "68", model: "01000078", tag: "6230" },
  ];

  const result = toDbBloodPressure(input);

  assertEquals(result.length, 2);
});

Deno.test("toDbBloodPressure: 脈拍なし", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "120", model: "01000078", tag: "622E" },
    { date: "202501150730", keydata: "80", model: "01000078", tag: "622F" },
  ];

  const result = toDbBloodPressure(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].systolic, 120);
  assertEquals(result[0].diastolic, 80);
  assertEquals(result[0].pulse, undefined);
});

Deno.test("toDbBloodPressure: 空配列", () => {
  const result = toDbBloodPressure([]);
  assertEquals(result.length, 0);
});

Deno.test("toDbBloodPressure: 手入力+実機データの混合は実機のmodelが優先", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "120", model: "00000000", tag: "622E" },
    { date: "202501150730", keydata: "80", model: "01000078", tag: "622F" },
  ];

  const result = toDbBloodPressure(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].model, "01000078");
});

// ============================================================
// toDbSteps
// ============================================================

Deno.test("toDbSteps: 歩数の変換", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "8500", model: "01000087", tag: "6331" },
  ];

  const result = toDbSteps(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].steps, 8500);
  assertEquals(result[0].model, "01000087");
  assertExists(result[0].measured_at);
});

Deno.test("toDbSteps: 複数日の歩数", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150000", keydata: "8500", model: "01000087", tag: "6331" },
    { date: "202501160000", keydata: "10200", model: "01000087", tag: "6331" },
    { date: "202501170000", keydata: "6300", model: "01000087", tag: "6331" },
  ];

  const result = toDbSteps(input);

  assertEquals(result.length, 3);
});

Deno.test("toDbSteps: 空配列", () => {
  const result = toDbSteps([]);
  assertEquals(result.length, 0);
});

Deno.test("toDbSteps: 歩数0も正しく記録", () => {
  const input: TanitaDataItem[] = [
    { date: "202501150000", keydata: "0", model: "01000087", tag: "6331" },
  ];

  const result = toDbSteps(input);

  assertEquals(result.length, 1);
  assertEquals(result[0].steps, 0);
});

// ============================================================
// 日付変換（JST → UTC）
// ============================================================

Deno.test("toDbBodyComposition: JST日付がUTCに正しく変換される", () => {
  // JST 2025-01-15 07:30 = UTC 2025-01-14 22:30
  const input: TanitaDataItem[] = [
    { date: "202501150730", keydata: "62.5", model: "01000089", tag: "6021" },
  ];

  const result = toDbBodyComposition(input);

  const measuredAt = new Date(result[0].measured_at);
  assertEquals(measuredAt.getUTCFullYear(), 2025);
  assertEquals(measuredAt.getUTCMonth(), 0); // 0-indexed
  assertEquals(measuredAt.getUTCDate(), 14); // JST 15日 7:30 = UTC 14日 22:30
  assertEquals(measuredAt.getUTCHours(), 22);
  assertEquals(measuredAt.getUTCMinutes(), 30);
});

Deno.test("toDbBodyComposition: 深夜0時のJST→UTC変換（日付が戻る）", () => {
  // JST 2025-01-15 00:00 = UTC 2025-01-14 15:00
  const input: TanitaDataItem[] = [
    { date: "202501150000", keydata: "62.5", model: "01000089", tag: "6021" },
  ];

  const result = toDbBodyComposition(input);

  const measuredAt = new Date(result[0].measured_at);
  assertEquals(measuredAt.getUTCDate(), 14);
  assertEquals(measuredAt.getUTCHours(), 15);
});

Deno.test("toDbBodyComposition: JST朝9時以降はUTC同日", () => {
  // JST 2025-01-15 09:00 = UTC 2025-01-15 00:00
  const input: TanitaDataItem[] = [
    { date: "202501150900", keydata: "62.5", model: "01000089", tag: "6021" },
  ];

  const result = toDbBodyComposition(input);

  const measuredAt = new Date(result[0].measured_at);
  assertEquals(measuredAt.getUTCDate(), 15);
  assertEquals(measuredAt.getUTCHours(), 0);
});
