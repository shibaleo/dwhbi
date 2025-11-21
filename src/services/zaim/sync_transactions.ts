// sync-zaim-transactions.ts
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
  skipped?: number;
}

// 同期オプション
interface SyncOptions {
  startDate?: string;  // YYYY-MM-DD形式
  endDate?: string;    // YYYY-MM-DD形式
  mode?: 'payment' | 'income' | 'transfer';
  limit?: number;      // 1回のAPI呼び出しで取得する件数（デフォルト100）
  batchSize?: number;  // DB upsertのバッチサイズ（デフォルト1000）
}

class ZaimTransactionSync {
  private supabase;
  private zaimApi: ZaimAPI;
  private zaimUserId: number | null = null;

  constructor() {
    // 環境変数の検証
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
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
    if (this.zaimUserId !== null) {
      return this.zaimUserId;
    }

    console.log('Zaim User IDを取得中...');
    const userInfo = await this.zaimApi.verifyUser();
    this.zaimUserId = userInfo.me.id;
    console.log(`✓ Zaim User ID取得完了`);
    
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
   * トランザクションデータの同期
   */
  async syncTransactions(options: SyncOptions = {}): Promise<SyncStats> {
    const logId = await this.startSyncLog('/v2/home/money');
    const stats: SyncStats = { fetched: 0, inserted: 0, updated: 0, skipped: 0 };

    try {
      console.log('\n=== トランザクション同期開始 ===');
      const zaimUserId = await this.fetchZaimUserId();

      // デフォルト設定: 過去30日間
      const endDate = options.endDate || new Date().toISOString().split('T')[0];
      const startDate = options.startDate || (() => {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return date.toISOString().split('T')[0];
      })();

      console.log(`期間: ${startDate} 〜 ${endDate}`);
      if (options.mode) {
        console.log(`種別: ${options.mode}`);
      }

      // 既存データのIDセットを取得（効率化のため期間内のみ）
      console.log('既存データを確認中...');
      const { data: existingTransactions } = await this.supabase
        .from('zaim_transactions')
        .select('zaim_id')
        .eq('zaim_user_id', zaimUserId)
        .gte('date', startDate)
        .lte('date', endDate);

      const existingIds = new Set(existingTransactions?.map(t => t.zaim_id) || []);
      console.log(`✓ 既存データ: ${existingIds.size}件`);

      // ページネーションで全データ取得
      let page = 1;
      let hasMore = true;
      const limit = options.limit || 100;
      const batchSize = options.batchSize || 1000;  // バッチサイズ
      const maxPages = 1000; // 無限ループ防止
      const seenTransactionIds = new Set<number>(); // 重複検出用
      const allRecords: any[] = [];  // 全レコードを蓄積

      console.log(`\n📥 APIからデータ取得中...`);
      
      while (hasMore && page <= maxPages) {
        const params: any = {
          start_date: startDate,
          end_date: endDate,
          page,
          limit,
        };

        if (options.mode) {
          params.mode = options.mode;
        }

        const { money: transactions } = await this.zaimApi.getMoney(params);

        if (!transactions || transactions.length === 0) {
          hasMore = false;
          break;
        }

        // 重複ページの検出
        const pageTransactionIds = transactions.map(t => t.id);
        const isDuplicate = pageTransactionIds.every(id => seenTransactionIds.has(id));
        
        if (isDuplicate && page > 1) {
          console.log(`  ⚠️ 重複ページを検出（ページ ${page}）: 取得完了`);
          hasMore = false;
          break;
        }

        stats.fetched += transactions.length;

        // 取得したトランザクションIDを記録
        transactions.forEach(t => seenTransactionIds.add(t.id));

        // データ準備（メモリに蓄積）
        for (const transaction of transactions) {
          // valid_accounts制約対応: transferの場合は両方のアカウントが必要
          if (transaction.mode === 'transfer') {
            if (!transaction.from_account_id || !transaction.to_account_id) {
              stats.skipped!++;
              continue;
            }
          }

          // アカウントIDの正規化（0をNULLに変換）
          const fromAccountId = (transaction.from_account_id && transaction.from_account_id > 0) 
            ? transaction.from_account_id 
            : null;
          const toAccountId = (transaction.to_account_id && transaction.to_account_id > 0) 
            ? transaction.to_account_id 
            : null;

          const record = {
            zaim_user_id: zaimUserId,
            zaim_id: transaction.id,
            transaction_type: transaction.mode,
            amount: transaction.amount,
            date: transaction.date,
            created_at: transaction.created || new Date().toISOString(),
            modified_at: transaction.modified || null,
            category_id: transaction.category_id || null,
            genre_id: transaction.genre_id || null,
            from_account_id: fromAccountId,
            to_account_id: toAccountId,
            place: transaction.place || null,
            name: transaction.name || null,
            comment: transaction.comment || null,
            is_active: transaction.active === undefined ? true : transaction.active === 1,
            receipt_id: transaction.receipt_id || null,
            synced_at: new Date().toISOString(),
          };

          allRecords.push(record);
          
          // 挿入/更新のカウント（事前計算）
          if (existingIds.has(transaction.id)) {
            stats.updated++;
          } else {
            stats.inserted++;
          }
        }

        // 進捗表示（10ページごと）
        if (page % 10 === 0 || !hasMore) {
          console.log(`  ページ ${page}: 累計 ${stats.fetched}件取得`);
        }

        // 次のページへ
        if (transactions.length < limit) {
          hasMore = false;
        } else {
          page++;
        }
      }

      if (page > maxPages) {
        console.warn(`⚠️ 最大ページ数 ${maxPages} に到達しました`);
      }

      console.log(`✓ API取得完了: ${stats.fetched}件`);

      // バッチでDB保存
      if (allRecords.length > 0) {
        console.log(`\n💾 データベースに保存中...`);
        const totalBatches = Math.ceil(allRecords.length / batchSize);
        
        for (let i = 0; i < allRecords.length; i += batchSize) {
          const batch = allRecords.slice(i, i + batchSize);
          const batchNumber = Math.floor(i / batchSize) + 1;
          
          console.log(`  バッチ ${batchNumber}/${totalBatches}: ${batch.length}件を保存中...`);
          
          const { error } = await this.supabase
            .from('zaim_transactions')
            .upsert(batch, {
              onConflict: 'zaim_user_id,zaim_id',
            });

          if (error) {
            console.error(`❌ バッチ ${batchNumber} の保存エラー:`, error.message);
            console.error(`   影響件数: ${batch.length}件`);
            stats.skipped! += batch.length;
            
            // エラー発生時は挿入/更新カウントを巻き戻し
            batch.forEach(record => {
              if (existingIds.has(record.zaim_id)) {
                stats.updated--;
              } else {
                stats.inserted--;
              }
            });
          }
        }
        
        console.log(`✓ データベース保存完了`);
      }

      if (stats.skipped! > 0) {
        console.warn(`⚠️ スキップされたトランザクション: ${stats.skipped}件`);
      }

      console.log(`\n✓ 合計取得: ${stats.fetched}件`);
      console.log(`✓ 挿入: ${stats.inserted}件, 更新: ${stats.updated}件`);
      await this.completeSyncLog(logId, 'completed', stats);
      
      return stats;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('トランザクション同期エラー:', errorMessage);
      await this.completeSyncLog(logId, 'failed', stats, errorMessage);
      throw error;
    }
  }

  /**
   * 全期間のトランザクションを同期（危険：大量データの可能性）
   */
  async syncAllTransactions(): Promise<SyncStats> {
    console.warn('⚠️  全期間同期: 大量のデータが取得される可能性があります');
    
    return await this.syncTransactions({
      startDate: '2000-01-01',  // 十分に古い日付
      endDate: new Date().toISOString().split('T')[0],
    });
  }

  /**
   * 最近N日間のトランザクションを同期
   */
  async syncRecentTransactions(days: number = 30): Promise<SyncStats> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return await this.syncTransactions({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });
  }

  /**
   * 月次トランザクションを同期
   */
  async syncMonthlyTransactions(year: number, month: number): Promise<SyncStats> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    console.log(`\n📅 ${year}年${month}月のトランザクションを同期`);

    return await this.syncTransactions({
      startDate,
      endDate,
    });
  }
}

export { ZaimTransactionSync };
export type { SyncStats, SyncOptions };