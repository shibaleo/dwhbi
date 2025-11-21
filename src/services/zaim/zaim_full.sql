-- ============================================================
-- Zaim財務データ管理テーブル（zaim_user_id版）
-- ============================================================

-- ============================================================
-- 1. マスタテーブル: カテゴリ（大分類）
-- ============================================================
CREATE TABLE zaim_categories (
  id INTEGER NOT NULL,
  zaim_user_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER,
  mode VARCHAR(10) CHECK (mode IN ('payment', 'income')),
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (zaim_user_id, id)
);

CREATE INDEX idx_zaim_categories_user ON zaim_categories(zaim_user_id);
CREATE INDEX idx_zaim_categories_mode ON zaim_categories(zaim_user_id, mode) WHERE is_active = true;

COMMENT ON TABLE zaim_categories IS 'Zaim大分類マスタ（食費、交通費など）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_categories TO service_role;

-- ============================================================
-- 2. マスタテーブル: ジャンル（小分類）
-- ============================================================
CREATE TABLE zaim_genres (
  id INTEGER NOT NULL,
  zaim_user_id BIGINT NOT NULL,
  category_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (zaim_user_id, id),
  FOREIGN KEY (zaim_user_id, category_id) REFERENCES zaim_categories(zaim_user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_zaim_genres_user ON zaim_genres(zaim_user_id);
CREATE INDEX idx_zaim_genres_category ON zaim_genres(zaim_user_id, category_id);

COMMENT ON TABLE zaim_genres IS 'Zaimジャンルマスタ（カテゴリ配下の詳細分類）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_genres TO service_role;

-- ============================================================
-- 3. マスタテーブル: 口座
-- ============================================================
CREATE TABLE zaim_accounts (
  id INTEGER NOT NULL,
  zaim_user_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (zaim_user_id, id)
);

CREATE INDEX idx_zaim_accounts_user ON zaim_accounts(zaim_user_id);

COMMENT ON TABLE zaim_accounts IS 'Zaim口座マスタ（現金、銀行口座、クレジットカードなど）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_accounts TO service_role;

-- ============================================================
-- 4. トランザクションテーブル
-- ============================================================
CREATE TABLE zaim_transactions (
  -- 基本情報
  zaim_user_id BIGINT NOT NULL,
  zaim_id BIGINT NOT NULL,
  transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('payment', 'income', 'transfer')),
  amount INTEGER NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  modified_at TIMESTAMPTZ,
  
  -- 分類情報
  category_id INTEGER,
  genre_id INTEGER,
  
  -- 口座情報
  from_account_id INTEGER,
  to_account_id INTEGER,
  
  -- 詳細情報
  place TEXT,
  name TEXT,
  comment TEXT,
  
  -- メタデータ
  is_active BOOLEAN DEFAULT true,
  receipt_id BIGINT,
  
  -- 同期管理
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- ===================================
  -- 主キー
  -- ===================================
  PRIMARY KEY (zaim_user_id, zaim_id),
  
  -- ===================================
  -- 外部キー制約
  -- ===================================
  -- カテゴリへの参照
  FOREIGN KEY (zaim_user_id, category_id) 
    REFERENCES zaim_categories(zaim_user_id, id)
    ON DELETE SET NULL,
  
  -- ジャンルへの参照
  FOREIGN KEY (zaim_user_id, genre_id) 
    REFERENCES zaim_genres(zaim_user_id, id)
    ON DELETE SET NULL,
  
  -- 支払元口座への参照
  FOREIGN KEY (zaim_user_id, from_account_id) 
    REFERENCES zaim_accounts(zaim_user_id, id)
    ON DELETE SET NULL,
  
  -- 入金先口座への参照
  FOREIGN KEY (zaim_user_id, to_account_id) 
    REFERENCES zaim_accounts(zaim_user_id, id)
    ON DELETE SET NULL,
  
  -- ===================================
  -- ビジネスルール制約（修正版）
  -- ===================================
  CONSTRAINT valid_accounts CHECK (
    -- payment（支出）: from_account_idが必須、to_account_idはNULL
    (transaction_type = 'payment' AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR
    -- income（収入）: to_account_idが必須、from_account_idはNULL
    (transaction_type = 'income' AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR
    -- transfer（振替）: 両方が必須
    (transaction_type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
  )
);

-- ===================================
-- 3. インデックスの作成
-- ===================================

-- 日付での検索を高速化
CREATE INDEX idx_zaim_transactions_date 
ON zaim_transactions(zaim_user_id, date DESC);

-- トランザクションタイプでの検索を高速化
CREATE INDEX idx_zaim_transactions_type 
ON zaim_transactions(zaim_user_id, transaction_type);

-- カテゴリでの検索を高速化
CREATE INDEX idx_zaim_transactions_category 
ON zaim_transactions(zaim_user_id, category_id) 
WHERE category_id IS NOT NULL;

-- ジャンルでの検索を高速化
CREATE INDEX idx_zaim_transactions_genre 
ON zaim_transactions(zaim_user_id, genre_id) 
WHERE genre_id IS NOT NULL;

-- 口座での検索を高速化
CREATE INDEX idx_zaim_transactions_from_account 
ON zaim_transactions(zaim_user_id, from_account_id) 
WHERE from_account_id IS NOT NULL;

CREATE INDEX idx_zaim_transactions_to_account 
ON zaim_transactions(zaim_user_id, to_account_id) 
WHERE to_account_id IS NOT NULL;

-- 同期時刻での検索を高速化
CREATE INDEX idx_zaim_transactions_synced_at 
ON zaim_transactions(zaim_user_id, synced_at DESC);

-- ===================================
-- 4. RLS（Row Level Security）の設定（オプション）
-- ===================================

-- RLSを有効化
ALTER TABLE zaim_transactions ENABLE ROW LEVEL SECURITY;

-- サービスロールには全アクセスを許可
CREATE POLICY "Service role can access all transactions" 
ON zaim_transactions 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- 認証済みユーザーは自分のデータのみアクセス可能（将来的な拡張用）
-- CREATE POLICY "Users can access their own transactions" 
-- ON zaim_transactions 
-- FOR ALL 
-- TO authenticated 
-- USING (zaim_user_id = auth.uid()::bigint) 
-- WITH CHECK (zaim_user_id = auth.uid()::bigint);

-- ===================================
-- 5. テーブル情報の確認
-- ===================================

-- テーブル構造の確認
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'zaim_transactions'
ORDER BY ordinal_position;

-- 制約の確認
SELECT 
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'zaim_transactions'::regclass
ORDER BY contype, conname;

-- インデックスの確認
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'zaim_transactions'
ORDER BY indexname;

COMMENT ON TABLE zaim_transactions IS 'Zaim取引データ（支出・収入・振替）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_transactions TO service_role;

-- ============================================================
-- 5. 同期ログテーブル
-- ============================================================
CREATE TABLE zaim_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaim_user_id BIGINT NOT NULL,
  sync_started_at TIMESTAMPTZ NOT NULL,
  sync_completed_at TIMESTAMPTZ,
  sync_status VARCHAR(20) NOT NULL CHECK (sync_status IN ('running', 'completed', 'failed')),
  records_fetched INTEGER,
  records_inserted INTEGER,
  records_updated INTEGER,
  error_message TEXT,
  api_endpoint VARCHAR(100),
  
  CONSTRAINT sync_time_check CHECK (
    sync_completed_at IS NULL OR 
    sync_completed_at >= sync_started_at
  )
);

CREATE INDEX idx_zaim_sync_log_user ON zaim_sync_log(zaim_user_id);
CREATE INDEX idx_zaim_sync_log_started ON zaim_sync_log(zaim_user_id, sync_started_at DESC);

COMMENT ON TABLE zaim_sync_log IS 'Zaim API同期履歴';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_sync_log TO service_role;

-- ============================================================
-- 分析用マテリアライズドビュー
-- ============================================================

CREATE MATERIALIZED VIEW zaim_monthly_summary AS
SELECT 
  zaim_user_id,
  DATE_TRUNC('month', date) AS month,
  transaction_type,
  category_id,
  SUM(amount) AS total_amount,
  COUNT(*) AS transaction_count,
  AVG(amount) AS avg_amount,
  MIN(amount) AS min_amount,
  MAX(amount) AS max_amount
FROM zaim_transactions
WHERE is_active = true
GROUP BY zaim_user_id, DATE_TRUNC('month', date), transaction_type, category_id;

CREATE UNIQUE INDEX idx_zaim_monthly_summary_unique 
ON zaim_monthly_summary(zaim_user_id, month, transaction_type, COALESCE(category_id, -1));

CREATE INDEX idx_zaim_monthly_summary_user_month 
ON zaim_monthly_summary(zaim_user_id, month DESC);

COMMENT ON MATERIALIZED VIEW zaim_monthly_summary IS '月次集計ビュー（定期的にREFRESHが必要）';

-- マテリアライズドビューの権限
GRANT SELECT ON zaim_monthly_summary TO service_role;

-- ============================================================
-- 便利な関数
-- ============================================================

-- マテリアライズドビューの更新関数
CREATE OR REPLACE FUNCTION refresh_zaim_monthly_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY zaim_monthly_summary;
END;
$$;

COMMENT ON FUNCTION refresh_zaim_monthly_summary() IS '月次集計ビューを更新';

-- 関数の権限
GRANT EXECUTE ON FUNCTION refresh_zaim_monthly_summary() TO service_role;

-- トランザクション統計取得関数
CREATE OR REPLACE FUNCTION get_zaim_stats(
  p_zaim_user_id BIGINT,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  total_income BIGINT,
  total_payment BIGINT,
  net_amount BIGINT,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END), 0) AS total_payment,
    COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount 
                      WHEN transaction_type = 'payment' THEN -amount 
                      ELSE 0 END), 0) AS net_amount,
    COUNT(*) AS transaction_count
  FROM zaim_transactions
  WHERE zaim_user_id = p_zaim_user_id
    AND is_active = true
    AND (p_start_date IS NULL OR date >= p_start_date)
    AND (p_end_date IS NULL OR date <= p_end_date);
END;
$$;

COMMENT ON FUNCTION get_zaim_stats(BIGINT, DATE, DATE) IS '期間内の収支統計を取得';

-- 関数の権限
GRANT EXECUTE ON FUNCTION get_zaim_stats(BIGINT, DATE, DATE) TO service_role;


-- ============================================================
-- RLS設定（Supabase警告回避用）
-- ============================================================

-- -----------------
-- zaim_categories
-- -----------------
ALTER TABLE zaim_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to categories"
ON zaim_categories
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------
-- zaim_genres
-- -----------------
ALTER TABLE zaim_genres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to genres"
ON zaim_genres
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------
-- zaim_accounts
-- -----------------
ALTER TABLE zaim_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to accounts"
ON zaim_accounts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------
-- zaim_transactions
-- -----------------
ALTER TABLE zaim_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to transactions"
ON zaim_transactions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------
-- zaim_sync_log
-- -----------------
ALTER TABLE zaim_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to sync logs"
ON zaim_sync_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================
-- 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'RLSポリシーが設定されました';
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'すべてのテーブルでRLSが有効化されています';
  RAISE NOTICE 'サービスロールキーは全アクセス権限を持ちます';
  RAISE NOTICE '=================================================';
END $$;

-- ============================================================
-- 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'ZaimテーブルがZaimユーザーID対応で作成されました';
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'テーブル:';
  RAISE NOTICE '  - zaim_categories (カテゴリマスタ)';
  RAISE NOTICE '  - zaim_genres (ジャンルマスタ)';
  RAISE NOTICE '  - zaim_accounts (口座マスタ)';
  RAISE NOTICE '  - zaim_transactions (取引データ)';
  RAISE NOTICE '  - zaim_sync_log (同期ログ)';
  RAISE NOTICE 'ビュー:';
  RAISE NOTICE '  - zaim_monthly_summary (月次集計)';
  RAISE NOTICE '関数:';
  RAISE NOTICE '  - refresh_zaim_monthly_summary()';
  RAISE NOTICE '  - get_zaim_stats(zaim_user_id, start_date, end_date)';
  RAISE NOTICE '=================================================';
  RAISE NOTICE '変更点:';
  RAISE NOTICE '  - user_id UUID → zaim_user_id BIGINT';
  RAISE NOTICE '  - Supabase Auth依存を削除';
  RAISE NOTICE '  - RLSポリシーを削除';
  RAISE NOTICE '  - サービスロールのみアクセス可能';
  RAISE NOTICE '=================================================';
END $$;