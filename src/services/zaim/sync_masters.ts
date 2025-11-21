// sync-zaim-masters.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ZaimAPI } from './api.ts';

// 環境変数の型定義
interface EnvConfig {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// 同期ログのステータス型
type SyncStatus = 'running' | 'completed' | 'failed';

// 同期統計情報
interface SyncStats {
  fetched: number;
  inserted: number;
  updated: number;
}

class ZaimMasterSync {
  private supabase;
  private zaimApi: ZaimAPI;
  private zaimUserId: number | null = null;

  constructor() {
    // 環境変数の検証
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env as unknown as EnvConfig;
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase環境変数が設定されていません');
    }

    // Supabaseクライアント初期化（サービスロールキーを使用）
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Zaim APIクライアント初期化
    this.zaimApi = new ZaimAPI();
  }

  /**
   * Zaim User IDを取得
   */
  private async fetchZaimUserId(): Promise<number> {
    if (this.zaimUserId !== null) return this.zaimUserId;

    console.log('Zaim User IDを取得中...');
    const userInfo = await this.zaimApi.verifyUser();
    this.zaimUserId = userInfo.me.id;
    const maskedId = `******${String(this.zaimUserId).slice(-2)}`;
    console.log(`✓ Zaim User ID: ${maskedId}`);
    
    return this.zaimUserId as number;
  }

  /**
   * 同期ログを開始
   */
  private async startSyncLog(endpoint: string): Promise<string> {
    const zaimUserId = await this.fetchZaimUserId();
    
    const { data, error } = await this.supabase
      .from('zaim_sync_log')
      .insert({
        zaim_user_id: zaimUserId,
        sync_started_at: new Date().toISOString(),
        sync_status: 'running' as SyncStatus,
        api_endpoint: endpoint,
      })
      .select('id')
      .single();

    if (error) throw new Error(`同期ログ開始エラー: ${error.message}`);
    return data.id;
  }

  /**
   * 同期ログを完了
   */
  private async completeSyncLog(
    logId: string,
    status: SyncStatus,
    stats: SyncStats,
    errorMessage?: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('zaim_sync_log')
      .update({
        sync_completed_at: new Date().toISOString(),
        sync_status: status,
        records_fetched: stats.fetched,
        records_inserted: stats.inserted,
        records_updated: stats.updated,
        error_message: errorMessage,
      })
      .eq('id', logId);

    if (error) {
      console.error(`同期ログ更新エラー: ${error.message}`);
    }
  }

  /**
   * カテゴリマスタの同期
   */
  async syncCategories(): Promise<SyncStats> {
    const logId = await this.startSyncLog('/v2/home/category');
    const stats: SyncStats = { fetched: 0, inserted: 0, updated: 0 };

    try {
      console.log('\n=== カテゴリマスタ同期開始 ===');
      const zaimUserId = await this.fetchZaimUserId();
      
      // Zaim APIからカテゴリ取得
      const { categories } = await this.zaimApi.getCategories();
      stats.fetched = categories.length;
      console.log(`取得件数: ${stats.fetched}件`);

      if (categories.length === 0) {
        console.log('⚠ 同期対象データなし');
        await this.completeSyncLog(logId, 'completed', stats);
        return stats;
      }

      // バルクupsert用のレコード配列を作成
      const records = categories.map(category => ({
        id: category.id,
        zaim_user_id: zaimUserId,
        name: category.name,
        sort_order: category.sort,
        mode: category.mode,
        is_active: category.active === 1,
        synced_at: new Date().toISOString(),
      }));

      // 一括upsert
      const { error, count } = await this.supabase
        .from('zaim_categories')
        .upsert(records, {
          onConflict: 'zaim_user_id,id',
          count: 'exact'
        });

      if (error) {
        throw new Error(`カテゴリの一括同期エラー: ${error.message}`);
      }

      stats.inserted = count || 0;
      
      console.log(`✓ 同期完了: ${count}件`);
      await this.completeSyncLog(logId, 'completed', stats);
      
      return stats;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('カテゴリ同期エラー:', errorMessage);
      await this.completeSyncLog(logId, 'failed', stats, errorMessage);
      throw error;
    }
  }

  /**
   * ジャンルマスタの同期
   */
  async syncGenres(): Promise<SyncStats> {
    const logId = await this.startSyncLog('/v2/home/genre');
    const stats: SyncStats = { fetched: 0, inserted: 0, updated: 0 };

    try {
      console.log('\n=== ジャンルマスタ同期開始 ===');
      const zaimUserId = await this.fetchZaimUserId();
      
      // Zaim APIからジャンル取得
      const { genres } = await this.zaimApi.getGenres();
      stats.fetched = genres.length;
      console.log(`取得件数: ${stats.fetched}件`);

      if (genres.length === 0) {
        console.log('⚠ 同期対象データなし');
        await this.completeSyncLog(logId, 'completed', stats);
        return stats;
      }

      // バルクupsert用のレコード配列を作成
      const records = genres.map(genre => ({
        id: genre.id,
        zaim_user_id: zaimUserId,
        category_id: genre.category_id,
        name: genre.name,
        sort_order: genre.sort,
        is_active: genre.active === 1,
        synced_at: new Date().toISOString(),
      }));

      // 一括upsert
      const { error, count } = await this.supabase
        .from('zaim_genres')
        .upsert(records, {
          onConflict: 'zaim_user_id,id',
          count: 'exact'
        });

      if (error) {
        throw new Error(`ジャンルの一括同期エラー: ${error.message}`);
      }

      stats.inserted = count || 0;
      
      console.log(`✓ 同期完了: ${count}件`);
      await this.completeSyncLog(logId, 'completed', stats);
      
      return stats;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('ジャンル同期エラー:', errorMessage);
      await this.completeSyncLog(logId, 'failed', stats, errorMessage);
      throw error;
    }
  }

  /**
   * 口座マスタの同期
   */
  async syncAccounts(): Promise<SyncStats> {
    const logId = await this.startSyncLog('/v2/home/account');
    const stats: SyncStats = { fetched: 0, inserted: 0, updated: 0 };

    try {
      console.log('\n=== 口座マスタ同期開始 ===');
      const zaimUserId = await this.fetchZaimUserId();
      
      // Zaim APIから口座取得
      const { accounts } = await this.zaimApi.getAccounts();
      stats.fetched = accounts.length;
      console.log(`取得件数: ${stats.fetched}件`);

      if (accounts.length === 0) {
        console.log('⚠ 同期対象データなし');
        await this.completeSyncLog(logId, 'completed', stats);
        return stats;
      }

      // バルクupsert用のレコード配列を作成
      const records = accounts.map(account => ({
        id: account.id,
        zaim_user_id: zaimUserId,
        name: account.name,
        sort_order: account.sort,
        is_active: account.active === 1,
        synced_at: new Date().toISOString(),
      }));

      // 一括upsert
      const { error, count } = await this.supabase
        .from('zaim_accounts')
        .upsert(records, {
          onConflict: 'zaim_user_id,id',
          count: 'exact'
        });

      if (error) {
        throw new Error(`口座の一括同期エラー: ${error.message}`);
      }

      stats.inserted = count || 0;
      
      console.log(`✓ 同期完了: ${count}件`);
      await this.completeSyncLog(logId, 'completed', stats);
      
      return stats;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('口座同期エラー:', errorMessage);
      await this.completeSyncLog(logId, 'failed', stats, errorMessage);
      throw error;
    }
  }
}

export { ZaimMasterSync };
export type { SyncStats };