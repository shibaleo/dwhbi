-- ============================================================
-- Zaim スキーマ作成
-- ============================================================
-- 実行順序: このファイルを上から順に実行してください
-- 前提条件: Supabase プロジェクトが作成済みであること
-- 
-- このファイルは既存の LIFETRACER Supabase スキーマと整合しています
-- ============================================================

-- スキーマ作成
CREATE SCHEMA IF NOT EXISTS zaim;

-- ============================================================
-- マスタテーブル
-- ============================================================

-- カテゴリ（大分類）
CREATE TABLE IF NOT EXISTS zaim.categories (
  id INTEGER NOT NULL,
  zaim_user_id BIGINT NOT NULL,
  name VARCHAR NOT NULL,
  sort_order INTEGER,
  mode VARCHAR CHECK (mode IN ('payment', 'income')),
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  PRIMARY KEY (zaim_user_id, id)
);

COMMENT ON TABLE zaim.categories IS 'Zaim カテゴリ（大分類）マスタ';
COMMENT ON COLUMN zaim.categories.zaim_user_id IS 'Zaim ユーザーID';
COMMENT ON COLUMN zaim.categories.id IS 'Zaim カテゴリID';
COMMENT ON COLUMN zaim.categories.mode IS '収支区分: payment(支出), income(収入)';

-- カテゴリ インデックス
CREATE INDEX IF NOT EXISTS idx_categories_user 
  ON zaim.categories (zaim_user_id);

CREATE INDEX IF NOT EXISTS idx_categories_mode 
  ON zaim.categories (zaim_user_id, mode) 
  WHERE is_active = true;

-- ジャンル（小分類）
CREATE TABLE IF NOT EXISTS zaim.genres (
  id INTEGER NOT NULL,
  zaim_user_id BIGINT NOT NULL,
  category_id INTEGER NOT NULL,
  name VARCHAR NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  PRIMARY KEY (zaim_user_id, id),
  FOREIGN KEY (zaim_user_id, category_id) 
    REFERENCES zaim.categories (zaim_user_id, id)
    ON DELETE CASCADE
);

COMMENT ON TABLE zaim.genres IS 'Zaim ジャンル（小分類）マスタ';
COMMENT ON COLUMN zaim.genres.category_id IS '親カテゴリID';

-- ジャンル インデックス
CREATE INDEX IF NOT EXISTS idx_genres_user 
  ON zaim.genres (zaim_user_id);

CREATE INDEX IF NOT EXISTS idx_genres_category 
  ON zaim.genres (zaim_user_id, category_id);

-- 口座
CREATE TABLE IF NOT EXISTS zaim.accounts (
  id INTEGER NOT NULL,
  zaim_user_id BIGINT NOT NULL,
  name VARCHAR NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  PRIMARY KEY (zaim_user_id, id)
);

COMMENT ON TABLE zaim.accounts IS 'Zaim 口座マスタ';

-- 口座 インデックス
CREATE INDEX IF NOT EXISTS idx_accounts_user 
  ON zaim.accounts (zaim_user_id);

-- ============================================================
-- トランザクションテーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS zaim.transactions (
  zaim_user_id BIGINT NOT NULL,
  zaim_id BIGINT NOT NULL,
  transaction_type VARCHAR NOT NULL 
    CHECK (transaction_type IN ('payment', 'income', 'transfer')),
  amount INTEGER NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  modified_at TIMESTAMPTZ,
  category_id INTEGER,
  genre_id INTEGER,
  from_account_id INTEGER,
  to_account_id INTEGER,
  place TEXT,
  name TEXT,
  comment TEXT,
  is_active BOOLEAN DEFAULT true,
  receipt_id BIGINT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  PRIMARY KEY (zaim_user_id, zaim_id),
  
  -- 取引種別ごとの口座制約
  -- payment: from_account_id必須, to_account_id禁止
  -- income: from_account_id禁止, to_account_id必須
  -- transfer: 両方必須
  CONSTRAINT valid_accounts CHECK (
    (transaction_type = 'payment' AND from_account_id IS NOT NULL AND to_account_id IS NULL)
    OR (transaction_type = 'income' AND from_account_id IS NULL AND to_account_id IS NOT NULL)
    OR (transaction_type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
  ),
  
  -- 外部キー（任意参照）
  FOREIGN KEY (zaim_user_id, category_id) 
    REFERENCES zaim.categories (zaim_user_id, id),
  FOREIGN KEY (zaim_user_id, genre_id) 
    REFERENCES zaim.genres (zaim_user_id, id),
  FOREIGN KEY (zaim_user_id, from_account_id) 
    REFERENCES zaim.accounts (zaim_user_id, id),
  FOREIGN KEY (zaim_user_id, to_account_id) 
    REFERENCES zaim.accounts (zaim_user_id, id)
);

COMMENT ON TABLE zaim.transactions IS 'Zaim 取引データ';
COMMENT ON COLUMN zaim.transactions.zaim_id IS 'Zaim 取引ID';
COMMENT ON COLUMN zaim.transactions.transaction_type IS '取引種別: payment(支出), income(収入), transfer(振替)';
COMMENT ON COLUMN zaim.transactions.from_account_id IS '出金元口座ID（振替・支出時）';
COMMENT ON COLUMN zaim.transactions.to_account_id IS '入金先口座ID（振替・収入時）';

-- トランザクション インデックス
CREATE INDEX IF NOT EXISTS idx_transactions_date 
  ON zaim.transactions (zaim_user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_type 
  ON zaim.transactions (zaim_user_id, transaction_type);

CREATE INDEX IF NOT EXISTS idx_transactions_category 
  ON zaim.transactions (zaim_user_id, category_id) 
  WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_genre 
  ON zaim.transactions (zaim_user_id, genre_id) 
  WHERE genre_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_from_account 
  ON zaim.transactions (zaim_user_id, from_account_id) 
  WHERE from_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_to_account 
  ON zaim.transactions (zaim_user_id, to_account_id) 
  WHERE to_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_synced_at 
  ON zaim.transactions (zaim_user_id, synced_at DESC);

-- ============================================================
-- 同期ログテーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS zaim.sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaim_user_id BIGINT NOT NULL,
  sync_started_at TIMESTAMPTZ NOT NULL,
  sync_completed_at TIMESTAMPTZ,
  sync_status VARCHAR NOT NULL 
    CHECK (sync_status IN ('running', 'completed', 'failed')),
  records_fetched INTEGER,
  records_inserted INTEGER,
  records_updated INTEGER,
  error_message TEXT,
  api_endpoint VARCHAR,
  
  -- 完了時刻は開始時刻以降
  CONSTRAINT sync_time_check CHECK (
    sync_completed_at IS NULL OR sync_completed_at >= sync_started_at
  )
);

COMMENT ON TABLE zaim.sync_log IS '同期実行ログ';

-- 同期ログ インデックス
CREATE INDEX IF NOT EXISTS idx_sync_log_user 
  ON zaim.sync_log (zaim_user_id);

CREATE INDEX IF NOT EXISTS idx_sync_log_started 
  ON zaim.sync_log (zaim_user_id, sync_started_at DESC);

-- ============================================================
-- マテリアライズドビュー
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS zaim.monthly_summary AS
SELECT
  zaim_user_id,
  date_trunc('month', date) AS month,
  transaction_type,
  category_id,
  SUM(amount) AS total_amount,
  COUNT(*) AS transaction_count,
  AVG(amount) AS avg_amount,
  MIN(amount) AS min_amount,
  MAX(amount) AS max_amount
FROM zaim.transactions
WHERE is_active = true
GROUP BY zaim_user_id, date_trunc('month', date), transaction_type, category_id;

COMMENT ON MATERIALIZED VIEW zaim.monthly_summary IS '月次集計（カテゴリ別）';

-- category_idがNULLの場合を考慮したユニークインデックス
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_summary_unique 
  ON zaim.monthly_summary (zaim_user_id, month, transaction_type, COALESCE(category_id, -1));

CREATE INDEX IF NOT EXISTS idx_monthly_summary_user_month 
  ON zaim.monthly_summary (zaim_user_id, month DESC);

-- ============================================================
-- public スキーマ互換ビュー（読み取り専用）
-- ============================================================

CREATE OR REPLACE VIEW public.zaim_categories AS
SELECT id, zaim_user_id, name, sort_order, mode, is_active, synced_at
FROM zaim.categories;

CREATE OR REPLACE VIEW public.zaim_genres AS
SELECT id, zaim_user_id, category_id, name, sort_order, is_active, synced_at
FROM zaim.genres;

CREATE OR REPLACE VIEW public.zaim_accounts AS
SELECT id, zaim_user_id, name, sort_order, is_active, synced_at
FROM zaim.accounts;

CREATE OR REPLACE VIEW public.zaim_transactions AS
SELECT 
  zaim_user_id, zaim_id, transaction_type, amount, date,
  created_at, modified_at, category_id, genre_id,
  from_account_id, to_account_id, place, name, comment,
  is_active, receipt_id, synced_at
FROM zaim.transactions;

CREATE OR REPLACE VIEW public.zaim_sync_log AS
SELECT 
  id, zaim_user_id, sync_started_at, sync_completed_at, sync_status,
  records_fetched, records_inserted, records_updated, error_message, api_endpoint
FROM zaim.sync_log;

CREATE OR REPLACE VIEW public.zaim_monthly_summary AS
SELECT 
  zaim_user_id, month, transaction_type, category_id,
  total_amount, transaction_count, avg_amount, min_amount, max_amount
FROM zaim.monthly_summary;

-- ============================================================
-- マテリアライズドビュー更新用関数
-- ============================================================

-- 月次集計を更新
-- 使用例: SELECT zaim.refresh_monthly_summary();
CREATE OR REPLACE FUNCTION zaim.refresh_monthly_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY zaim.monthly_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS (Row Level Security) - 必要に応じて有効化
-- ============================================================

-- 現時点では service_role_key を使用するため RLS は無効
-- 将来的にユーザー認証を導入する場合は以下を有効化

-- ALTER TABLE zaim.categories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE zaim.genres ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE zaim.accounts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE zaim.transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE zaim.sync_log ENABLE ROW LEVEL SECURITY;
