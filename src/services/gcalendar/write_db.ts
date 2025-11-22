/**
 * Google Calendar DB書き込み
 * 
 * Supabase gcalendar スキーマへの upsert
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DbEvent } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/** gcalendar スキーマ用 Supabase クライアント型 */
export type GCalSchema = {
  events: DbEvent;
};

// =============================================================================
// Client Factory
// =============================================================================

/**
 * Supabase クライアントを作成（gcalendar スキーマ用）
 */
export function createGCalClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  return createClient(supabaseUrl, supabaseKey, {
    db: { schema: "gcalendar" },
  });
}

// =============================================================================
// Upsert Functions
// =============================================================================

/** バッチサイズ（PostgreSQL最適化） */
const BATCH_SIZE = 1000;

/**
 * イベントを一括 upsert
 */
export async function upsertEvents(
  client: SupabaseClient,
  events: DbEvent[]
): Promise<number> {
  if (events.length === 0) {
    return 0;
  }

  let upsertedCount = 0;

  // バッチ処理
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    
    const { error } = await client
      .from("events")
      .upsert(batch, {
        onConflict: "id",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`Failed to upsert events: ${error.message}`);
    }

    upsertedCount += batch.length;
    
    // バッチ間にわずかな待機（レート制限対策）
    if (i + BATCH_SIZE < events.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return upsertedCount;
}

/**
 * キャンセルされたイベントのステータスを更新
 * （API応答でキャンセルされたイベントが返ってこない場合用）
 */
export async function markCancelledEvents(
  client: SupabaseClient,
  existingIds: string[],
  fetchedIds: Set<string>
): Promise<number> {
  // 取得されなかったIDを特定
  const missingIds = existingIds.filter(id => !fetchedIds.has(id));
  
  if (missingIds.length === 0) {
    return 0;
  }

  // statusをcancelledに更新
  const { error, count } = await client
    .from("events")
    .update({ status: "cancelled" })
    .in("id", missingIds)
    .neq("status", "cancelled");

  if (error) {
    throw new Error(`Failed to mark cancelled events: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * 指定期間のイベントIDを取得
 */
export async function getExistingEventIds(
  client: SupabaseClient,
  timeMin: string,
  timeMax: string
): Promise<string[]> {
  const { data, error } = await client
    .from("events")
    .select("id")
    .gte("start_time", timeMin)
    .lte("start_time", timeMax);

  if (error) {
    throw new Error(`Failed to get existing event IDs: ${error.message}`);
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}
