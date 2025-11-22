// test/zaim/write_db.test.ts
// write_db.ts の変換関数に対する単体テスト

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  toDbCategory,
  toDbGenre,
  toDbAccount,
  toDbTransaction,
} from "../../src/services/zaim/write_db.ts";

import type {
  ZaimTransaction,
  ZaimCategory,
  ZaimGenre,
  ZaimAccount,
} from "../../src/services/zaim/types.ts";

// ============================================================
// toDbCategory
// ============================================================

Deno.test("toDbCategory: 基本的な変換", () => {
  const input: ZaimCategory = {
    id: 101,
    name: "食費",
    sort: 1,
    mode: "payment",
    active: 1,
  };

  const result = toDbCategory(input, 12345);

  assertEquals(result.id, 101);
  assertEquals(result.zaim_user_id, 12345);
  assertEquals(result.name, "食費");
  assertEquals(result.sort_order, 1);
  assertEquals(result.mode, "payment");
  assertEquals(result.is_active, true);
  assertExists(result.synced_at);
});

Deno.test("toDbCategory: active=0 → is_active=false", () => {
  const input: ZaimCategory = {
    id: 102,
    name: "削除済み",
    sort: 99,
    mode: "income",
    active: 0,
  };

  const result = toDbCategory(input, 12345);

  assertEquals(result.is_active, false);
});

// ============================================================
// toDbGenre
// ============================================================

Deno.test("toDbGenre: 基本的な変換", () => {
  const input: ZaimGenre = {
    id: 201,
    category_id: 101,
    name: "外食",
    sort: 2,
    active: 1,
  };

  const result = toDbGenre(input, 12345);

  assertEquals(result.id, 201);
  assertEquals(result.zaim_user_id, 12345);
  assertEquals(result.category_id, 101);
  assertEquals(result.name, "外食");
  assertEquals(result.sort_order, 2);
  assertEquals(result.is_active, true);
  assertExists(result.synced_at);
});

Deno.test("toDbGenre: active=0 → is_active=false", () => {
  const input: ZaimGenre = {
    id: 202,
    category_id: 101,
    name: "非アクティブ",
    sort: 99,
    active: 0,
  };

  const result = toDbGenre(input, 12345);

  assertEquals(result.is_active, false);
});

// ============================================================
// toDbAccount
// ============================================================

Deno.test("toDbAccount: 基本的な変換", () => {
  const input: ZaimAccount = {
    id: 301,
    name: "現金",
    sort: 1,
    active: 1,
  };

  const result = toDbAccount(input, 12345);

  assertEquals(result.id, 301);
  assertEquals(result.zaim_user_id, 12345);
  assertEquals(result.name, "現金");
  assertEquals(result.sort_order, 1);
  assertEquals(result.is_active, true);
  assertExists(result.synced_at);
});

Deno.test("toDbAccount: active=0 → is_active=false", () => {
  const input: ZaimAccount = {
    id: 302,
    name: "解約済み口座",
    sort: 99,
    active: 0,
  };

  const result = toDbAccount(input, 12345);

  assertEquals(result.is_active, false);
});

// ============================================================
// toDbTransaction
// ============================================================

Deno.test("toDbTransaction: 支出の基本的な変換", () => {
  const input: ZaimTransaction = {
    id: 1001,
    mode: "payment",
    user_id: 12345,
    date: "2025-01-15",
    category_id: 101,
    genre_id: 201,
    from_account_id: 301,
    amount: 1500,
    name: "ランチ",
    place: "カフェ",
    comment: "同僚と",
    created: "2025-01-15T12:00:00+09:00",
    modified: "2025-01-15T12:30:00+09:00",
    active: 1,
    receipt_id: 5001,
  };

  const result = toDbTransaction(input, 12345);

  assertEquals(result.zaim_user_id, 12345);
  assertEquals(result.zaim_id, 1001);
  assertEquals(result.transaction_type, "payment");
  assertEquals(result.amount, 1500);
  assertEquals(result.date, "2025-01-15");
  assertEquals(result.category_id, 101);
  assertEquals(result.genre_id, 201);
  assertEquals(result.from_account_id, 301);
  assertEquals(result.to_account_id, null);
  assertEquals(result.name, "ランチ");
  assertEquals(result.place, "カフェ");
  assertEquals(result.comment, "同僚と");
  assertEquals(result.is_active, true);
  assertEquals(result.receipt_id, 5001);
  assertExists(result.created_at);
  assertExists(result.modified_at);
  assertExists(result.synced_at);
});

Deno.test("toDbTransaction: account_id=0 → null変換", () => {
  const input: ZaimTransaction = {
    id: 1002,
    mode: "payment",
    user_id: 12345,
    date: "2025-01-15",
    category_id: 101,
    genre_id: 201,
    from_account_id: 0,
    to_account_id: 0,
    amount: 500,
  };

  const result = toDbTransaction(input, 12345);

  assertEquals(result.from_account_id, null);
  assertEquals(result.to_account_id, null);
});

Deno.test("toDbTransaction: オプショナルフィールド未設定 → null", () => {
  const input: ZaimTransaction = {
    id: 1003,
    mode: "income",
    user_id: 12345,
    date: "2025-01-15",
    category_id: 102,
    genre_id: 202,
    amount: 50000,
    // name, place, comment, receipt_id は未設定
  };

  const result = toDbTransaction(input, 12345);

  assertEquals(result.name, null);
  assertEquals(result.place, null);
  assertEquals(result.comment, null);
  assertEquals(result.receipt_id, null);
  assertEquals(result.modified_at, null);
});

Deno.test("toDbTransaction: active未定義 → is_active=true（デフォルト）", () => {
  const input: ZaimTransaction = {
    id: 1004,
    mode: "payment",
    user_id: 12345,
    date: "2025-01-15",
    category_id: 101,
    genre_id: 201,
    amount: 100,
    // active は未設定
  };

  const result = toDbTransaction(input, 12345);

  assertEquals(result.is_active, true);
});

Deno.test("toDbTransaction: active=0 → is_active=false", () => {
  const input: ZaimTransaction = {
    id: 1005,
    mode: "payment",
    user_id: 12345,
    date: "2025-01-15",
    category_id: 101,
    genre_id: 201,
    amount: 100,
    active: 0,
  };

  const result = toDbTransaction(input, 12345);

  assertEquals(result.is_active, false);
});

Deno.test("toDbTransaction: 振替（transfer）の変換", () => {
  const input: ZaimTransaction = {
    id: 1006,
    mode: "transfer",
    user_id: 12345,
    date: "2025-01-15",
    category_id: 0,
    genre_id: 0,
    from_account_id: 301,
    to_account_id: 302,
    amount: 10000,
    active: 1,
  };

  const result = toDbTransaction(input, 12345);

  assertEquals(result.transaction_type, "transfer");
  assertEquals(result.from_account_id, 301);
  assertEquals(result.to_account_id, 302);
});
