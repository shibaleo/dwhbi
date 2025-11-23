// test/notion/type_mapping.test.ts
// type_mapping.ts の変換関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  propertyNameToColumn,
  notionTypeToPostgres,
} from "../../src/services/notion/type_mapping.ts";

// ============================================================
// propertyNameToColumn
// ============================================================

Deno.test("propertyNameToColumn: 基本的な変換", () => {
  const result = propertyNameToColumn("Name");
  assertEquals(result, "name");
});

Deno.test("propertyNameToColumn: スペースをアンダースコアに", () => {
  const result = propertyNameToColumn("Full Name");
  assertEquals(result, "full_name");
});

Deno.test("propertyNameToColumn: ハイフンをアンダースコアに", () => {
  const result = propertyNameToColumn("first-name");
  assertEquals(result, "first_name");
});

Deno.test("propertyNameToColumn: 括弧をアンダースコアに", () => {
  const result = propertyNameToColumn("1st-period(min)");
  assertEquals(result, "1st_period_min");
});

Deno.test("propertyNameToColumn: スラッシュをアンダースコアに", () => {
  const result = propertyNameToColumn("date/time");
  assertEquals(result, "date_time");
});

Deno.test("propertyNameToColumn: 複数の特殊文字を含む", () => {
  const result = propertyNameToColumn("Test-Name (Value)/Status");
  assertEquals(result, "test_name_value_status");
});

Deno.test("propertyNameToColumn: 連続するアンダースコアを1つに", () => {
  const result = propertyNameToColumn("test  name--value");
  assertEquals(result, "test_name_value");
});

Deno.test("propertyNameToColumn: 先頭のアンダースコアを削除", () => {
  const result = propertyNameToColumn("-test");
  assertEquals(result, "test");
});

Deno.test("propertyNameToColumn: 末尾のアンダースコアを削除", () => {
  const result = propertyNameToColumn("test-");
  assertEquals(result, "test");
});

Deno.test("propertyNameToColumn: 先頭と末尾の両方のアンダースコアを削除", () => {
  const result = propertyNameToColumn("-test-");
  assertEquals(result, "test");
});

// ============================================================
// notionTypeToPostgres
// ============================================================

Deno.test("notionTypeToPostgres: title型", () => {
  const result = notionTypeToPostgres("title");
  assertEquals(result, "text NOT NULL");
});

Deno.test("notionTypeToPostgres: rich_text型", () => {
  const result = notionTypeToPostgres("rich_text");
  assertEquals(result, "text");
});

Deno.test("notionTypeToPostgres: number型", () => {
  const result = notionTypeToPostgres("number");
  assertEquals(result, "numeric");
});

Deno.test("notionTypeToPostgres: checkbox型", () => {
  const result = notionTypeToPostgres("checkbox");
  assertEquals(result, "boolean");
});

Deno.test("notionTypeToPostgres: date型（JSONB）", () => {
  const result = notionTypeToPostgres("date");
  assertEquals(result, "jsonb");
});

Deno.test("notionTypeToPostgres: select型", () => {
  const result = notionTypeToPostgres("select");
  assertEquals(result, "text");
});

Deno.test("notionTypeToPostgres: multi_select型（配列）", () => {
  const result = notionTypeToPostgres("multi_select");
  assertEquals(result, "text[]");
});

Deno.test("notionTypeToPostgres: people型（配列）", () => {
  const result = notionTypeToPostgres("people");
  assertEquals(result, "text[]");
});

Deno.test("notionTypeToPostgres: rollup型（JSONB）", () => {
  const result = notionTypeToPostgres("rollup");
  assertEquals(result, "jsonb");
});

Deno.test("notionTypeToPostgres: formula型（JSONB）", () => {
  const result = notionTypeToPostgres("formula");
  assertEquals(result, "jsonb");
});

Deno.test("notionTypeToPostgres: created_time型", () => {
  const result = notionTypeToPostgres("created_time");
  assertEquals(result, "timestamptz");
});

Deno.test("notionTypeToPostgres: 未知の型はtextにフォールバック", () => {
  const result = notionTypeToPostgres("unknown_type");
  assertEquals(result, "text");
});
