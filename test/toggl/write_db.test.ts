// test/toggl/write_db.test.ts
// write_db.ts の変換関数に対する単体テスト

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  toDbClient,
  toDbProject,
  toDbTag,
  toDbEntry,
} from "../../src/services/toggl/write_db.ts";

import type {
  TogglApiV9Client,
  TogglApiV9Project,
  TogglApiV9Tag,
  TogglApiV9TimeEntry,
} from "../../src/services/toggl/types.ts";

// ============================================================
// toDbClient
// ============================================================

Deno.test("toDbClient: 基本的な変換", () => {
  const input: TogglApiV9Client = {
    id: 12345678,
    wid: 1234567,
    archived: false,
    name: "Test Client",
    at: "2025-01-15T10:00:00+00:00",
  };

  const result = toDbClient(input);

  assertEquals(result.id, 12345678);
  assertEquals(result.workspace_id, 1234567);
  assertEquals(result.name, "Test Client");
  assertEquals(result.is_archived, false);
  assertEquals(result.created_at, "2025-01-15T10:00:00+00:00");
});

Deno.test("toDbClient: archived=true の変換", () => {
  const input: TogglApiV9Client = {
    id: 12345679,
    wid: 1234567,
    archived: true,
    name: "Archived Client",
    at: "2025-01-10T10:00:00+00:00",
  };

  const result = toDbClient(input);

  assertEquals(result.is_archived, true);
});

// ============================================================
// toDbProject
// ============================================================

Deno.test("toDbProject: 基本的な変換", () => {
  const input: TogglApiV9Project = {
    id: 98765432,
    workspace_id: 1234567,
    client_id: 12345678,
    name: "Test Project",
    is_private: false,
    active: true,
    at: "2025-01-15T10:00:00+00:00",
    created_at: "2025-01-01T00:00:00+00:00",
    color: "#ff0000",
    billable: true,
  };

  const result = toDbProject(input);

  assertEquals(result.id, 98765432);
  assertEquals(result.workspace_id, 1234567);
  assertEquals(result.client_id, 12345678);
  assertEquals(result.name, "Test Project");
  assertEquals(result.is_private, false);
  assertEquals(result.is_active, true);
  assertEquals(result.is_billable, true);
  assertEquals(result.color, "#ff0000");
  assertEquals(result.created_at, "2025-01-01T00:00:00+00:00");
});

Deno.test("toDbProject: client_id=null の変換", () => {
  const input: TogglApiV9Project = {
    id: 98765433,
    workspace_id: 1234567,
    client_id: null,
    name: "No Client Project",
    is_private: true,
    active: false,
    at: "2025-01-15T10:00:00+00:00",
    created_at: "2025-01-01T00:00:00+00:00",
    color: "#00ff00",
  };

  const result = toDbProject(input);

  assertEquals(result.client_id, null);
  assertEquals(result.is_active, false);
  assertEquals(result.is_private, true);
});

Deno.test("toDbProject: オプショナルフィールド未設定 → null/デフォルト", () => {
  const input: TogglApiV9Project = {
    id: 98765434,
    workspace_id: 1234567,
    name: "Minimal Project",
    is_private: false,
    active: true,
    at: "2025-01-15T10:00:00+00:00",
    created_at: "2025-01-01T00:00:00+00:00",
    color: "#0000ff",
    // billable, template, estimated_hours 等は未設定
  };

  const result = toDbProject(input);

  assertEquals(result.is_billable, false); // デフォルト
  assertEquals(result.is_template, false); // デフォルト
  assertEquals(result.estimated_hours, null);
  assertEquals(result.rate, null);
  assertEquals(result.currency, null);
});

Deno.test("toDbProject: server_deleted_at → archived_at", () => {
  const input: TogglApiV9Project = {
    id: 98765435,
    workspace_id: 1234567,
    name: "Deleted Project",
    is_private: false,
    active: false,
    at: "2025-01-15T10:00:00+00:00",
    created_at: "2025-01-01T00:00:00+00:00",
    server_deleted_at: "2025-01-10T12:00:00+00:00",
    color: "#999999",
  };

  const result = toDbProject(input);

  assertEquals(result.archived_at, "2025-01-10T12:00:00+00:00");
});

// ============================================================
// toDbTag
// ============================================================

Deno.test("toDbTag: 基本的な変換", () => {
  const input: TogglApiV9Tag = {
    id: 11111111,
    workspace_id: 1234567,
    name: "m:calm",
    at: "2025-01-15T10:00:00+00:00",
  };

  const result = toDbTag(input);

  assertEquals(result.id, 11111111);
  assertEquals(result.workspace_id, 1234567);
  assertEquals(result.name, "m:calm");
  assertEquals(result.created_at, "2025-01-15T10:00:00+00:00");
});

// ============================================================
// toDbEntry
// ============================================================

Deno.test("toDbEntry: 基本的な変換", () => {
  const input: TogglApiV9TimeEntry = {
    id: 3333333333,
    workspace_id: 1234567,
    project_id: 98765432,
    task_id: null,
    billable: false,
    start: "2025-01-15T09:00:00+00:00",
    stop: "2025-01-15T10:30:00+00:00",
    duration: 5400, // 90分 = 5400秒
    description: "タスク作業",
    tags: ["m:calm", "work"],
    duronly: false,
    at: "2025-01-15T10:30:00+00:00",
    user_id: 9999999,
    uid: 9999999,
    wid: 1234567,
  };

  const result = toDbEntry(input);

  assertExists(result);
  assertEquals(result!.id, 3333333333);
  assertEquals(result!.workspace_id, 1234567);
  assertEquals(result!.project_id, 98765432);
  assertEquals(result!.task_id, null);
  assertEquals(result!.user_id, 9999999);
  assertEquals(result!.description, "タスク作業");
  assertEquals(result!.start, "2025-01-15T09:00:00+00:00");
  assertEquals(result!.end, "2025-01-15T10:30:00+00:00");
  assertEquals(result!.duration_ms, 5400000); // 秒 → ミリ秒
  assertEquals(result!.is_billable, false);
  assertEquals(result!.tags, ["m:calm", "work"]);
  assertEquals(result!.updated_at, "2025-01-15T10:30:00+00:00");
});

Deno.test("toDbEntry: 実行中エントリー（duration < 0）→ null", () => {
  const input: TogglApiV9TimeEntry = {
    id: 3333333334,
    workspace_id: 1234567,
    project_id: 98765432,
    billable: false,
    start: "2025-01-15T09:00:00+00:00",
    stop: null,
    duration: -1737018000, // 負の値 = 実行中
    duronly: false,
    at: "2025-01-15T10:30:00+00:00",
    user_id: 9999999,
    uid: 9999999,
    wid: 1234567,
  };

  const result = toDbEntry(input);

  assertEquals(result, null);
});

Deno.test("toDbEntry: stop=null → end=start", () => {
  const input: TogglApiV9TimeEntry = {
    id: 3333333335,
    workspace_id: 1234567,
    project_id: 98765432,
    billable: false,
    start: "2025-01-15T09:00:00+00:00",
    stop: null,
    duration: 3600, // 1時間（完了済みだがstopがない）
    duronly: false,
    at: "2025-01-15T10:00:00+00:00",
    user_id: 9999999,
    uid: 9999999,
    wid: 1234567,
  };

  const result = toDbEntry(input);

  assertExists(result);
  assertEquals(result!.end, "2025-01-15T09:00:00+00:00"); // startと同じ
});

Deno.test("toDbEntry: project_id=null の変換", () => {
  const input: TogglApiV9TimeEntry = {
    id: 3333333336,
    workspace_id: 1234567,
    project_id: null,
    billable: false,
    start: "2025-01-15T09:00:00+00:00",
    stop: "2025-01-15T09:30:00+00:00",
    duration: 1800,
    duronly: false,
    at: "2025-01-15T09:30:00+00:00",
    user_id: 9999999,
    uid: 9999999,
    wid: 1234567,
  };

  const result = toDbEntry(input);

  assertExists(result);
  assertEquals(result!.project_id, null);
});

Deno.test("toDbEntry: tags未設定 → 空配列", () => {
  const input: TogglApiV9TimeEntry = {
    id: 3333333337,
    workspace_id: 1234567,
    project_id: 98765432,
    billable: true,
    start: "2025-01-15T09:00:00+00:00",
    stop: "2025-01-15T10:00:00+00:00",
    duration: 3600,
    duronly: false,
    at: "2025-01-15T10:00:00+00:00",
    user_id: 9999999,
    uid: 9999999,
    wid: 1234567,
    // tags は未設定
  };

  const result = toDbEntry(input);

  assertExists(result);
  assertEquals(result!.tags, []);
  assertEquals(result!.is_billable, true);
});

Deno.test("toDbEntry: description未設定 → null", () => {
  const input: TogglApiV9TimeEntry = {
    id: 3333333338,
    workspace_id: 1234567,
    project_id: 98765432,
    billable: false,
    start: "2025-01-15T09:00:00+00:00",
    stop: "2025-01-15T09:15:00+00:00",
    duration: 900,
    duronly: false,
    at: "2025-01-15T09:15:00+00:00",
    user_id: 9999999,
    uid: 9999999,
    wid: 1234567,
    // description は未設定
  };

  const result = toDbEntry(input);

  assertExists(result);
  assertEquals(result!.description, null);
});
