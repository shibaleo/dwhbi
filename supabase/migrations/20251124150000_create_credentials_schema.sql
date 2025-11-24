-- =============================================================================
-- credentials スキーマ作成
-- =============================================================================
-- 
-- 外部サービスの認証情報を暗号化して保存
-- 
-- =============================================================================

-- スキーマ作成
CREATE SCHEMA IF NOT EXISTS credentials;

-- -----------------------------------------------------------------------------
-- oauth_tokens テーブル
-- -----------------------------------------------------------------------------
CREATE TABLE credentials.services (
  service TEXT PRIMARY KEY,              -- 'fitbit', 'tanita', 'toggl', etc.
  auth_type TEXT NOT NULL,               -- 'oauth2', 'oauth1', 'basic', 'api_key', 'service_account'
  credentials_encrypted BYTEA NOT NULL,  -- 暗号化されたJSON
  nonce BYTEA NOT NULL,                  -- AES-GCM nonce (12 bytes)
  expires_at TIMESTAMPTZ,                -- OAuth用（access_tokenの有効期限）
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- コメント
COMMENT ON TABLE credentials.services IS '外部サービスの認証情報（暗号化済み）';
COMMENT ON COLUMN credentials.services.service IS 'サービス識別子: fitbit, tanita, toggl, zaim, gcalendar, notion, supabase';
COMMENT ON COLUMN credentials.services.auth_type IS '認証方式: oauth2, oauth1, basic, api_key, service_account';
COMMENT ON COLUMN credentials.services.credentials_encrypted IS 'AES-256-GCMで暗号化されたJSON';
COMMENT ON COLUMN credentials.services.nonce IS 'AES-GCM nonce (12 bytes)';
COMMENT ON COLUMN credentials.services.expires_at IS 'access_tokenの有効期限（OAuth用）';

-- 更新日時の自動更新トリガー
CREATE OR REPLACE FUNCTION credentials.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_updated_at
  BEFORE UPDATE ON credentials.services
  FOR EACH ROW
  EXECUTE FUNCTION credentials.update_updated_at();

-- RLS有効化
ALTER TABLE credentials.services ENABLE ROW LEVEL SECURITY;

-- service_role のみアクセス可能
CREATE POLICY "Service role full access" ON credentials.services
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- anon/authenticated はアクセス不可（ポリシーなし = 拒否）

-- 権限設定
GRANT USAGE ON SCHEMA credentials TO service_role;
GRANT ALL ON credentials.services TO service_role;

-- -----------------------------------------------------------------------------
-- 完了メッセージ
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '=== credentials schema created ===';
  RAISE NOTICE 'Table: credentials.services';
  RAISE NOTICE 'Access: service_role only';
END $$;
