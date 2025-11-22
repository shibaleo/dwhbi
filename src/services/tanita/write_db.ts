/**
 * Tanita データの Supabase 書き込み
 *
 * tanita スキーマへのデータ変換と upsert 処理
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as log from "../../utils/log.ts";
import { parseTanitaDate } from "./api.ts";
import type {
  DbBloodPressure,
  DbBodyComposition,
  DbSteps,
  TanitaDataItem,
} from "./types.ts";
import { TAGS } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/** tanita スキーマ用クライアント型 */
export type TanitaSchema = ReturnType<SupabaseClient["schema"]>;

/** upsert 結果 */
export interface UpsertResult {
  success: number;
  failed: number;
}

// =============================================================================
// Constants
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// Client Factory
// =============================================================================

/**
 * tanita スキーマ専用の Supabase クライアントを作成
 */
export function createTanitaDbClient(): TanitaSchema {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, key);
  return supabase.schema("tanita");
}

// =============================================================================
// Transform Functions: API → DB Record
// =============================================================================

/**
 * 体組成データを測定時刻でグループ化して DB レコードに変換
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

    if (item.model !== "00000000") {
      record.model = item.model;
    }
  }

  return Array.from(byTimestamp.values());
}

/**
 * 血圧データを測定時刻でグループ化して DB レコードに変換
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
 * 歩数データを測定時刻でグループ化して DB レコードに変換
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

// =============================================================================
// Batch Upsert
// =============================================================================

/**
 * バッチ upsert
 */
async function upsertBatch<T extends object>(
  tanita: TanitaSchema,
  table: string,
  records: T[],
  onConflict: string,
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await tanita
      .from(table)
      .upsert(batch, { onConflict });

    if (error) {
      log.error(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      failed += batch.length;
    } else {
      success += batch.length;
    }
  }

  return { success, failed };
}

// =============================================================================
// Save Functions
// =============================================================================

/**
 * 体組成データを DB に保存
 */
export async function saveBodyComposition(
  tanita: TanitaSchema,
  items: TanitaDataItem[],
): Promise<UpsertResult> {
  const records = toDbBodyComposition(items);
  log.info(`Saving body composition data... (${records.length} records)`);

  const result = await upsertBatch(tanita, "body_composition", records, "measured_at");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 血圧データを DB に保存
 */
export async function saveBloodPressure(
  tanita: TanitaSchema,
  items: TanitaDataItem[],
): Promise<UpsertResult> {
  const records = toDbBloodPressure(items);
  log.info(`Saving blood pressure data... (${records.length} records)`);

  const result = await upsertBatch(tanita, "blood_pressure", records, "measured_at");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}

/**
 * 歩数データを DB に保存
 */
export async function saveSteps(
  tanita: TanitaSchema,
  items: TanitaDataItem[],
): Promise<UpsertResult> {
  const records = toDbSteps(items);
  log.info(`Saving steps data... (${records.length} records)`);

  const result = await upsertBatch(tanita, "steps", records, "measured_at");

  if (result.success > 0) log.success(`${result.success} records saved`);
  if (result.failed > 0) log.error(`${result.failed} records failed`);

  return result;
}
