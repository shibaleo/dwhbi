-- =============================================================================
-- Supabase Vault への移行
-- =============================================================================
--
-- credentials.services (AES-256-GCM暗号化) から vault.secrets に移行
-- Supabase Vaultはデータベース管理の暗号化キーを使用した透過的暗号化を提供
--
-- =============================================================================

-- Vault extension を有効化
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- -----------------------------------------------------------------------------
-- vault.secrets テーブルは extension により自動作成される
--
-- 保存形式:
--   name: サービス識別子（例: "fitbit", "toggl"）
--   secret: JSON文字列（認証情報 + expires_at + auth_type）
--   description: サービス説明
--
-- 読み取りは vault.decrypted_secrets ビューを使用（自動復号）
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- service_role に Vault 操作権限を付与
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA vault TO service_role;
GRANT ALL ON vault.secrets TO service_role;
GRANT SELECT ON vault.decrypted_secrets TO service_role;

-- pgsodium の暗号化関数への権限付与
GRANT USAGE ON SCHEMA pgsodium TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgsodium TO service_role;

-- vault の関数への権限付与
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA vault TO service_role;

-- -----------------------------------------------------------------------------
-- 完了メッセージ
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '=== Vault extension enabled ===';
  RAISE NOTICE 'Table: vault.secrets (auto-created by extension)';
  RAISE NOTICE 'View: vault.decrypted_secrets (for reading)';
  RAISE NOTICE 'Permissions: service_role granted';
  RAISE NOTICE '';
  RAISE NOTICE 'Next step: Run the Python migration script to move data from credentials.services to vault.secrets';
END $$;
