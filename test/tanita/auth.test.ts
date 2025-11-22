// test/tanita/auth.test.ts
// auth.ts の純粋関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { isTokenExpiringSoon } from "../../src/services/tanita/auth.ts";

// ============================================================
// isTokenExpiringSoon
// ============================================================

Deno.test("isTokenExpiringSoon: 期限切れ間近（閾値内）はtrue", () => {
  // 現在から3日後に期限切れ、閾値7日
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 7);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 期限に余裕あり（閾値外）はfalse", () => {
  // 現在から30日後に期限切れ、閾値7日
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 7);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: ちょうど閾値はtrue", () => {
  // 現在からちょうど7日後、閾値7日
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 7);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 既に期限切れはtrue", () => {
  // 現在から1日前に期限切れ
  const expiresAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 7);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 閾値0日で期限切れでなければfalse", () => {
  // 現在から1時間後に期限切れ、閾値0日
  const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 0);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: 閾値0日で既に期限切れはtrue", () => {
  // 現在から1時間前に期限切れ、閾値0日
  const expiresAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 0);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: デフォルト閾値（7日）が適用される", () => {
  // 現在から5日後に期限切れ、閾値省略（デフォルト7日）
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: デフォルト閾値で余裕ありはfalse", () => {
  // 現在から10日後に期限切れ、閾値省略（デフォルト7日）
  const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: 大きな閾値（30日）", () => {
  // 現在から20日後に期限切れ、閾値30日
  const expiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 30);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 遠い未来の期限はfalse", () => {
  // 現在から1年後に期限切れ
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 7);
  
  assertEquals(result, false);
});
