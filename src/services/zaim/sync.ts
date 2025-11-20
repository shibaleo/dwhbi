// zaim/sync.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ZaimAPI } from "./api.ts";
import type { ZaimTransaction, ZaimCategory, ZaimGenre, ZaimAccount } from "./api.ts";

export class ZaimSupabaseSync {
  private supabase;
  private zaimApi: ZaimAPI;
  private userId: string;

  constructor(userId: string) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase credentials not found");
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.zaimApi = new ZaimAPI();
    this.userId = userId;
  }

  // カテゴリ同期
  async syncCategories(): Promise<void> {
    console.log("Syncing categories...");
    const { categories } = await this.zaimApi.getCategories();

    for (const category of categories) {
      await this.supabase
        .from("zaim_categories")
        .upsert({
          id: category.id,
          user_id: this.userId,
          name: category.name,
          sort_order: category.sort,
          mode: category.mode,
          is_active: category.active === 1,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: "user_id,id"
        });
    }

    console.log(`✓ Synced ${categories.length} categories`);
  }

  // ジャンル同期
  async syncGenres(): Promise<void> {
    console.log("Syncing genres...");
    const { genres } = await this.zaimApi.getGenres();

    for (const genre of genres) {
      await this.supabase
        .from("zaim_genres")
        .upsert({
          id: genre.id,
          user_id: this.userId,
          category_id: genre.category_id,
          name: genre.name,
          sort_order: genre.sort,
          is_active: genre.active === 1,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: "user_id,id"
        });
    }

    console.log(`✓ Synced ${genres.length} genres`);
  }

  // 口座同期
  async syncAccounts(): Promise<void> {
    console.log("Syncing accounts...");
    const { accounts } = await this.zaimApi.getAccounts();

    for (const account of accounts) {
      await this.supabase
        .from("zaim_accounts")
        .upsert({
          id: account.id,
          user_id: this.userId,
          name: account.name,
          sort_order: account.sort,
          is_active: account.active === 1,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: "user_id,id"
        });
    }

    console.log(`✓ Synced ${accounts.length} accounts`);
  }

  // 取引データ同期
  async syncTransactions(startDate?: string, endDate?: string): Promise<void> {
    console.log("Syncing transactions...");
    
    const params: any = {
      limit: 100,
    };
    
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    const { money } = await this.zaimApi.getMoney(params);

    let inserted = 0;
    let updated = 0;

    for (const transaction of money) {
      const { data: existing } = await this.supabase
        .from("zaim_transactions")
        .select("id")
        .eq("user_id", this.userId)
        .eq("zaim_id", transaction.id)
        .single();

      const transactionData = {
        user_id: this.userId,
        zaim_id: transaction.id,
        transaction_type: transaction.mode,
        amount: transaction.amount,
        date: transaction.date,
        created_at: transaction.created || new Date().toISOString(),
        modified_at: transaction.modified,
        category_id: transaction.category_id,
        genre_id: transaction.genre_id,
        from_account_id: transaction.from_account_id,
        to_account_id: transaction.to_account_id,
        place: transaction.place,
        name: transaction.name,
        comment: transaction.comment,
        is_active: transaction.active === 1,
        receipt_id: transaction.receipt_id,
        synced_at: new Date().toISOString(),
        last_modified_at: new Date().toISOString(),
      };

      if (existing) {
        await this.supabase
          .from("zaim_transactions")
          .update(transactionData)
          .eq("id", existing.id);
        updated++;
      } else {
        await this.supabase
          .from("zaim_transactions")
          .insert(transactionData);
        inserted++;
      }
    }

    console.log(`✓ Synced ${money.length} transactions (${inserted} new, ${updated} updated)`);
  }

  // 同期ログ記録
  async logSync(
    endpoint: string,
    status: "running" | "completed" | "failed",
    stats?: {
      fetched?: number;
      inserted?: number;
      updated?: number;
      error?: string;
    }
  ): Promise<string> {
    const logData: any = {
      user_id: this.userId,
      api_endpoint: endpoint,
      sync_status: status,
      sync_started_at: new Date().toISOString(),
    };

    if (status === "completed" || status === "failed") {
      logData.sync_completed_at = new Date().toISOString();
      logData.records_fetched = stats?.fetched;
      logData.records_inserted = stats?.inserted;
      logData.records_updated = stats?.updated;
      logData.error_message = stats?.error;
    }

    const { data, error } = await this.supabase
      .from("zaim_sync_log")
      .insert(logData)
      .select("id")
      .single();

    if (error) throw error;
    return data.id;
  }

  // 完全同期
  async fullSync(): Promise<void> {
    const logId = await this.logSync("full_sync", "running");

    try {
      console.log("Starting full sync...\n");

      await this.syncCategories();
      await this.syncGenres();
      await this.syncAccounts();
      await this.syncTransactions();

      await this.supabase
        .from("zaim_sync_log")
        .update({
          sync_status: "completed",
          sync_completed_at: new Date().toISOString(),
        })
        .eq("id", logId);

      console.log("\n✅ Full sync completed successfully");
    } catch (error) {
      await this.supabase
        .from("zaim_sync_log")
        .update({
          sync_status: "failed",
          sync_completed_at: new Date().toISOString(),
          error_message: error.message,
        })
        .eq("id", logId);

      console.error("\n❌ Sync failed:", error);
      throw error;
    }
  }
}