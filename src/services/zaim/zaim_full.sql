-- ============================================================
-- Zaim財務データ管理テーブル（権限設定込み）
-- ============================================================

-- 既存テーブルの削除（必要に応じてコメントアウト）
DROP TABLE IF EXISTS zaim_sync_log CASCADE;
DROP MATERIALIZED VIEW IF EXISTS zaim_monthly_summary CASCADE;
DROP TABLE IF EXISTS zaim_transactions CASCADE;
DROP TABLE IF EXISTS zaim_genres CASCADE;
DROP TABLE IF EXISTS zaim_categories CASCADE;
DROP TABLE IF EXISTS zaim_accounts CASCADE;

-- ============================================================
-- 1. マスタテーブル: カテゴリ（大分類）
-- ============================================================
CREATE TABLE zaim_categories (
  id INTEGER PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER,
  mode VARCHAR(10) CHECK (mode IN ('payment', 'income')),
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, id)
);

CREATE INDEX idx_zaim_categories_user ON zaim_categories(user_id);
CREATE INDEX idx_zaim_categories_mode ON zaim_categories(mode) WHERE is_active = true;

COMMENT ON TABLE zaim_categories IS 'Zaim大分類マスタ（食費、交通費など）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_categories TO service_role;

-- ============================================================
-- 2. マスタテーブル: ジャンル（小分類）
-- ============================================================
CREATE TABLE zaim_genres (
  id INTEGER PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, category_id) REFERENCES zaim_categories(user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_zaim_genres_user ON zaim_genres(user_id);
CREATE INDEX idx_zaim_genres_category ON zaim_genres(user_id, category_id);

COMMENT ON TABLE zaim_genres IS 'Zaimジャンルマスタ（カテゴリ配下の詳細分類）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_genres TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_genres TO service_role;

-- ============================================================
-- 3. マスタテーブル: 口座
-- ============================================================
CREATE TABLE zaim_accounts (
  id INTEGER PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, id)
);

CREATE INDEX idx_zaim_accounts_user ON zaim_accounts(user_id);

COMMENT ON TABLE zaim_accounts IS 'Zaim口座マスタ（現金、銀行口座、クレジットカードなど）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_accounts TO service_role;

-- ============================================================
-- 4. トランザクションテーブル
-- ============================================================
CREATE TABLE zaim_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- 制約
  UNIQUE(user_id, zaim_id),
  
  FOREIGN KEY (user_id, category_id) REFERENCES zaim_categories(user_id, id),
  FOREIGN KEY (user_id, genre_id) REFERENCES zaim_genres(user_id, id),
  FOREIGN KEY (user_id, from_account_id) REFERENCES zaim_accounts(user_id, id),
  FOREIGN KEY (user_id, to_account_id) REFERENCES zaim_accounts(user_id, id),
  
  CONSTRAINT valid_accounts CHECK (
    (transaction_type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL) OR
    (transaction_type != 'transfer' AND to_account_id IS NULL)
  )
);

CREATE INDEX idx_zaim_transactions_user ON zaim_transactions(user_id);
CREATE INDEX idx_zaim_transactions_date ON zaim_transactions(user_id, date DESC);
CREATE INDEX idx_zaim_transactions_type ON zaim_transactions(user_id, transaction_type);
CREATE INDEX idx_zaim_transactions_category ON zaim_transactions(user_id, category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_zaim_transactions_account ON zaim_transactions(user_id, from_account_id) WHERE from_account_id IS NOT NULL;
CREATE INDEX idx_zaim_transactions_active ON zaim_transactions(user_id, is_active) WHERE is_active = true;

COMMENT ON TABLE zaim_transactions IS 'Zaim取引データ（支出・収入・振替）';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_transactions TO service_role;

-- ============================================================
-- 5. 同期ログテーブル
-- ============================================================
CREATE TABLE zaim_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX idx_zaim_sync_log_user ON zaim_sync_log(user_id);
CREATE INDEX idx_zaim_sync_log_started ON zaim_sync_log(user_id, sync_started_at DESC);

COMMENT ON TABLE zaim_sync_log IS 'Zaim API同期履歴';

-- 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_sync_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON zaim_sync_log TO service_role;

-- ============================================================
-- RLS（Row Level Security）設定
-- ============================================================

-- -----------------
-- zaim_categories
-- -----------------
ALTER TABLE zaim_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own categories"
ON zaim_categories
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own categories"
ON zaim_categories
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own categories"
ON zaim_categories
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own categories"
ON zaim_categories
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service roleはRLSをバイパス
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

CREATE POLICY "Users can view their own genres"
ON zaim_genres
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own genres"
ON zaim_genres
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own genres"
ON zaim_genres
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own genres"
ON zaim_genres
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service roleはRLSをバイパス
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

CREATE POLICY "Users can view their own accounts"
ON zaim_accounts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own accounts"
ON zaim_accounts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own accounts"
ON zaim_accounts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own accounts"
ON zaim_accounts
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service roleはRLSをバイパス
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

CREATE POLICY "Users can view their own transactions"
ON zaim_transactions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions"
ON zaim_transactions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
ON zaim_transactions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
ON zaim_transactions
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service roleはRLSをバイパス
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

CREATE POLICY "Users can view their own sync logs"
ON zaim_sync_log
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync logs"
ON zaim_sync_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync logs"
ON zaim_sync_log
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Service roleはRLSをバイパス
CREATE POLICY "Service role has full access to sync logs"
ON zaim_sync_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================
-- 分析用マテリアライズドビュー
-- ============================================================

CREATE MATERIALIZED VIEW zaim_monthly_summary AS
SELECT 
  user_id,
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
GROUP BY user_id, DATE_TRUNC('month', date), transaction_type, category_id;

CREATE UNIQUE INDEX idx_zaim_monthly_summary_unique 
ON zaim_monthly_summary(user_id, month, transaction_type, COALESCE(category_id, -1));

CREATE INDEX idx_zaim_monthly_summary_user_month 
ON zaim_monthly_summary(user_id, month DESC);

COMMENT ON MATERIALIZED VIEW zaim_monthly_summary IS '月次集計ビュー（定期的にREFRESHが必要）';

-- マテリアライズドビューの権限
GRANT SELECT ON zaim_monthly_summary TO authenticated;
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
GRANT EXECUTE ON FUNCTION refresh_zaim_monthly_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_zaim_monthly_summary() TO service_role;

-- トランザクション統計取得関数
CREATE OR REPLACE FUNCTION get_zaim_stats(
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
  WHERE user_id = auth.uid()
    AND is_active = true
    AND (p_start_date IS NULL OR date >= p_start_date)
    AND (p_end_date IS NULL OR date <= p_end_date);
END;
$$;

COMMENT ON FUNCTION get_zaim_stats(DATE, DATE) IS '期間内の収支統計を取得';

-- 関数の権限
GRANT EXECUTE ON FUNCTION get_zaim_stats(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_zaim_stats(DATE, DATE) TO service_role;

-- ============================================================
-- 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'ZaimテーブルとRLS設定が完了しました';
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
  RAISE NOTICE '  - get_zaim_stats(start_date, end_date)';
  RAISE NOTICE '=================================================';
END $$;