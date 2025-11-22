// test/gcalendar/fetch_data.test.ts
// fetch_data.ts の変換関数に対する単体テスト

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { transformEvent } from "../../src/services/gcalendar/fetch_data.ts";
import type { GCalApiEvent } from "../../src/services/gcalendar/types.ts";

const TEST_CALENDAR_ID = "test-calendar@example.com";

// ============================================================
// 通常イベント（dateTime）
// ============================================================

Deno.test("transformEvent: 通常イベントの基本変換", () => {
  const input: GCalApiEvent = {
    id: "event123abc",
    etag: '"etag123"',
    status: "confirmed",
    summary: "ミーティング",
    description: "週次ミーティング",
    colorId: "5",
    start: {
      dateTime: "2025-01-15T10:00:00+09:00",
      timeZone: "Asia/Tokyo",
    },
    end: {
      dateTime: "2025-01-15T11:00:00+09:00",
      timeZone: "Asia/Tokyo",
    },
    updated: "2025-01-14T09:00:00+09:00",
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.id, "event123abc");
  assertEquals(result.calendar_id, TEST_CALENDAR_ID);
  assertEquals(result.summary, "ミーティング");
  assertEquals(result.description, "週次ミーティング");
  assertEquals(result.start_time, "2025-01-15T10:00:00+09:00");
  assertEquals(result.end_time, "2025-01-15T11:00:00+09:00");
  assertEquals(result.is_all_day, false);
  assertEquals(result.color_id, "5");
  assertEquals(result.status, "confirmed");
  assertEquals(result.etag, '"etag123"');
  assertEquals(result.updated, "2025-01-14T09:00:00+09:00");
});

Deno.test("transformEvent: recurring_event_id の変換", () => {
  const input: GCalApiEvent = {
    id: "event456_20250115T100000Z",
    status: "confirmed",
    summary: "定例ミーティング",
    recurringEventId: "event456",
    start: {
      dateTime: "2025-01-15T10:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T11:00:00+09:00",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.recurring_event_id, "event456");
});

// ============================================================
// 終日イベント（date）
// ============================================================

Deno.test("transformEvent: 終日イベントの変換", () => {
  const input: GCalApiEvent = {
    id: "allday123",
    status: "confirmed",
    summary: "休暇",
    start: {
      date: "2025-01-20",
    },
    end: {
      date: "2025-01-21",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.start_time, "2025-01-20T00:00:00+09:00");
  assertEquals(result.end_time, "2025-01-21T00:00:00+09:00");
  assertEquals(result.is_all_day, true);
});

Deno.test("transformEvent: 複数日終日イベント", () => {
  const input: GCalApiEvent = {
    id: "vacation123",
    status: "confirmed",
    summary: "旅行",
    start: {
      date: "2025-01-20",
    },
    end: {
      date: "2025-01-25",  // 5日間
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.start_time, "2025-01-20T00:00:00+09:00");
  assertEquals(result.end_time, "2025-01-25T00:00:00+09:00");
  assertEquals(result.is_all_day, true);
});

// ============================================================
// オプショナルフィールドのnull変換
// ============================================================

Deno.test("transformEvent: summary未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "nosummary123",
    status: "confirmed",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // summary は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.summary, null);
});

Deno.test("transformEvent: description未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "nodesc123",
    status: "confirmed",
    summary: "タイトルのみ",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // description は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.description, null);
});

Deno.test("transformEvent: colorId未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "nocolor123",
    status: "confirmed",
    summary: "色なしイベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // colorId は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.color_id, null);
});

Deno.test("transformEvent: etag未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "noetag123",
    status: "confirmed",
    summary: "テストイベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // etag は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.etag, null);
});

Deno.test("transformEvent: updated未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "noupdated123",
    status: "confirmed",
    summary: "テストイベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // updated は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.updated, null);
});

Deno.test("transformEvent: recurring_event_id未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "single123",
    status: "confirmed",
    summary: "単発イベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // recurringEventId は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.recurring_event_id, null);
});

// ============================================================
// ステータスの変換
// ============================================================

Deno.test("transformEvent: status=confirmed", () => {
  const input: GCalApiEvent = {
    id: "confirmed123",
    status: "confirmed",
    summary: "確定イベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.status, "confirmed");
});

Deno.test("transformEvent: status=tentative", () => {
  const input: GCalApiEvent = {
    id: "tentative123",
    status: "tentative",
    summary: "仮イベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.status, "tentative");
});

Deno.test("transformEvent: status=cancelled", () => {
  const input: GCalApiEvent = {
    id: "cancelled123",
    status: "cancelled",
    summary: "キャンセルされたイベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.status, "cancelled");
});

Deno.test("transformEvent: status未設定 → null", () => {
  const input: GCalApiEvent = {
    id: "nostatus123",
    summary: "ステータスなし",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
    // status は未設定
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.status, null);
});

// ============================================================
// エッジケース
// ============================================================

Deno.test("transformEvent: 最小限のフィールドのみ", () => {
  const input: GCalApiEvent = {
    id: "minimal123",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.id, "minimal123");
  assertEquals(result.calendar_id, TEST_CALENDAR_ID);
  assertEquals(result.summary, null);
  assertEquals(result.description, null);
  assertEquals(result.is_all_day, false);
  assertEquals(result.color_id, null);
  assertEquals(result.status, null);
  assertEquals(result.recurring_event_id, null);
  assertEquals(result.etag, null);
  assertEquals(result.updated, null);
});

Deno.test("transformEvent: 異なるカレンダーID", () => {
  const input: GCalApiEvent = {
    id: "diffcal123",
    status: "confirmed",
    summary: "別カレンダーのイベント",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
  };

  const differentCalendarId = "another-calendar@example.com";
  const result = transformEvent(input, differentCalendarId);

  assertEquals(result.calendar_id, differentCalendarId);
});

Deno.test("transformEvent: 日本語タイトル・説明", () => {
  const input: GCalApiEvent = {
    id: "japanese123",
    status: "confirmed",
    summary: "日本語タイトル テスト 🎉",
    description: "これは日本語の説明です。\n改行も含みます。",
    start: {
      dateTime: "2025-01-15T14:00:00+09:00",
    },
    end: {
      dateTime: "2025-01-15T15:00:00+09:00",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  assertEquals(result.summary, "日本語タイトル テスト 🎉");
  assertEquals(result.description, "これは日本語の説明です。\n改行も含みます。");
});

Deno.test("transformEvent: UTC時間の通常イベント", () => {
  const input: GCalApiEvent = {
    id: "utc123",
    status: "confirmed",
    summary: "UTC時間のイベント",
    start: {
      dateTime: "2025-01-15T01:00:00Z",
    },
    end: {
      dateTime: "2025-01-15T02:00:00Z",
    },
  };

  const result = transformEvent(input, TEST_CALENDAR_ID);

  // UTCのまま保存される（変換はしない）
  assertEquals(result.start_time, "2025-01-15T01:00:00Z");
  assertEquals(result.end_time, "2025-01-15T02:00:00Z");
  assertEquals(result.is_all_day, false);
});
