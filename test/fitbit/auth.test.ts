// test/fitbit/auth.test.ts
// auth.ts の純粋関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { isTokenExpiringSoon } from "../../src/services/fitbit/auth.ts";

// ============================================================
// isTokenExpiringSoon（分単位の閾値）
// ============================================================

Deno.test("isTokenExpiringSoon: 期限切れ間近（閾値内）はtrue", () => {
  // 現在から30分後に期限切れ、閾値60分
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 60);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 期限に余裕あり（閾値外）はfalse", () => {
  // 現在から2時間後に期限切れ、閾値60分
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 60);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: ちょうど閾値はtrue", () => {
  // 現在からちょうど60分後、閾値60分
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 60);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 既に期限切れはtrue", () => {
  // 現在から10分前に期限切れ
  const expiresAt = new Date(Date.now() - 10 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 60);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: 閾値0分で期限切れでなければfalse", () => {
  // 現在から1分後に期限切れ、閾値0分
  const expiresAt = new Date(Date.now() + 1 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 0);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: 閾値0分で既に期限切れはtrue", () => {
  // 現在から1分前に期限切れ、閾値0分
  const expiresAt = new Date(Date.now() - 1 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 0);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: デフォルト閾値（60分）が適用される", () => {
  // 現在から30分後に期限切れ、閾値省略（デフォルト60分）
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt);
  
  assertEquals(result, true);
});

Deno.test("isTokenExpiringSoon: デフォルト閾値で余裕ありはfalse", () => {
  // 現在から2時間後に期限切れ、閾値省略（デフォルト60分）
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: 8時間（Fitbitトークン有効期限）", () => {
  // Fitbitトークンの有効期限は8時間
  // 現在から7時間後に期限切れ、閾値60分
  const expiresAt = new Date(Date.now() + 7 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 60);
  
  assertEquals(result, false);
});

Deno.test("isTokenExpiringSoon: 遠い未来の期限はfalse", () => {
  // 現在から24時間後に期限切れ
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  const result = isTokenExpiringSoon(expiresAt, 60);
  
  assertEquals(result, false);
});
