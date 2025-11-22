// write_db.ts
// Tanita データの Supabase 書き込み

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseTanitaDate } from "./api.ts";
import type {
  DbBloodPressure,
  DbBodyComposition,
  DbSteps,
  TanitaDataItem,
} from "./types.ts";
import { TAGS } from "./types.ts";

// ========== 定数 ==========

const SCHEMA = "tanita";
const BATCH_SIZE = 1000;

// ========== Supabase クライアント ==========

export function createTanitaDbClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY が必要です");
  }

  return createClient(url, key);
}

// ========== 変換関数: API → DB レコード ==========

/**
 * 体組成データを測定時刻でグループ化してDBレコードに変換
 */
export function toDbBodyComposition(
  items: TanitaDataItem[],
): DbBodyComposition[] {
  const byTimestamp: Map<string, DbBodyComposition> = new Map();

  for (const item of items) {
    const measuredAt = parseTanitaDate(item.date);
    const key = measuredAt.toISOString();

    if (!byTimestamp.has(key)) {
      byTimestamp.set(key, {
        measured_at: key,
        model: item.model,
      });
    }

    const record = byTimestamp.get(key)!;

    if (item.tag === TAGS.WEIGHT) {
      record.weight = parseFloat(item.keydata);
    } else if (item.tag === TAGS.BODY_FAT_PERCENT) {
      record.body_fat_percent = parseFloat(item.keydata);
    }

    // 最新のmodelを保持
    if (item.model !== "00000000") {
      record.model = item.model;
    }
  }

  return Array.from(byTimestamp.values());
}

/**
 * 血圧データを測定時刻でグループ化してDBレコードに変換
 */
export function toDbBloodPressure(items: TanitaDataItem[]): DbBloodPressure[] {
  const byTimestamp: Map<string, DbBloodPressure> = new Map();

  for (const item of items) {
    const measuredAt = parseTanitaDate(item.date);
    const key = measuredAt.toISOString();

    if (!byTimestamp.has(key)) {
      byTimestamp.set(key, {
        measured_at: key,
        model: item.model,
      });
    }

    const record = byTimestamp.get(key)!;

    if (item.tag === TAGS.SYSTOLIC) {
      record.systolic = parseInt(item.keydata);
    } else if (item.tag === TAGS.DIASTOLIC) {
      record.diastolic = parseInt(item.keydata);
    } else if (item.tag === TAGS.PULSE) {
      record.pulse = parseInt(item.keydata);
    }

    if (item.model !== "00000000") {
      record.model = item.model;
    }
  }

  return Array.from(byTimestamp.values());
}

/**
 * 歩数データを測定時刻でグループ化してDBレコードに変換
 */
export function toDbSteps(items: TanitaDataItem[]): DbSteps[] {
  const byTimestamp: Map<string, DbSteps> = new Map();

  for (const item of items) {
    const measuredAt = parseTanitaDate(item.date);
    const key = measuredAt.toISOString();

    if (!byTimestamp.has(key)) {
      byTimestamp.set(key, {
        measured_at: key,
        model: item.model,
      });
    }

    const record = byTimestamp.get(key)!;

    if (item.tag === TAGS.STEPS) {
      record.steps = parseInt(item.keydata);
    }

    if (item.model !== "00000000") {
      record.model = item.model;
    }
  }

  return Array.from(byTimestamp.values());
}

// ========== DB書き込み ==========

export interface UpsertResult {
  success: number;
  failed: number;
}

/**
 * バッチupsert
 */
async function upsertBatch<T extends object>(
  supabase: SupabaseClient,
  table: string,
  records: T[],
  onConflict: string,
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  // バッチ処理
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .schema(SCHEMA)
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      console.error(
        `   ❌ バッチ ${
          Math.floor(i / BATCH_SIZE) + 1
        } エラー: ${error.message}`,
      );
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

/**
 * 体組成データをDBに保存
 */
export async function saveBodyComposition(
  supabase: SupabaseClient,
  items: TanitaDataItem[],
): Promise<UpsertResult> {
  const records = toDbBodyComposition(items);
  console.log(`💾 体組成データ保存中... (${records.length}件)`);

  const result = await upsertBatch(
    supabase,
    "body_composition",
    records,
    "measured_at",
  );

  if (result.success > 0) {
    console.log(`   ✓ ${result.success}件保存`);
  }
  if (result.failed > 0) {
    console.log(`   ✗ ${result.failed}件失敗`);
  }

  return result;
}

/**
 * 血圧データをDBに保存
 */
export async function saveBloodPressure(
  supabase: SupabaseClient,
  items: TanitaDataItem[],
): Promise<UpsertResult> {
  const records = toDbBloodPressure(items);
  console.log(`💾 血圧データ保存中... (${records.length}件)`);

  const result = await upsertBatch(
    supabase,
    "blood_pressure",
    records,
    "measured_at",
  );

  if (result.success > 0) {
    console.log(`   ✓ ${result.success}件保存`);
  }
  if (result.failed > 0) {
    console.log(`   ✗ ${result.failed}件失敗`);
  }

  return result;
}

/**
 * 歩数データをDBに保存
 */
export async function saveSteps(
  supabase: SupabaseClient,
  items: TanitaDataItem[],
): Promise<UpsertResult> {
  const records = toDbSteps(items);
  console.log(`💾 歩数データ保存中... (${records.length}件)`);

  const result = await upsertBatch(supabase, "steps", records, "measured_at");

  if (result.success > 0) {
    console.log(`   ✓ ${result.success}件保存`);
  }
  if (result.failed > 0) {
    console.log(`   ✗ ${result.failed}件失敗`);
  }

  return result;
}
