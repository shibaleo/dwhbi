-- ============================================================================
-- Create DWH Schemas: raw, staging, marts
-- Created: 2024-11-24
-- ============================================================================
--
-- 構造:
--   raw.*      - 外部APIからの生データ（テーブル）
--   staging.*  - クリーニング・正規化済み（ビュー）
--   marts.*    - ビジネスエンティティ・集計（ビュー）
--
-- ============================================================================

-- スキーマ作成
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS marts;

-- コメント追加
COMMENT ON SCHEMA raw IS '外部APIからの生データを格納。変換なし、60年保持。';
COMMENT ON SCHEMA staging IS 'rawデータのクリーニング・正規化。タイムゾーン変換、列名統一。';
COMMENT ON SCHEMA marts IS 'ビジネスエンティティと集計。dim_/fct_/agg_プレフィックス。';

-- search_path に追加（デフォルトのpublic, extensionsを維持）
ALTER DATABASE postgres SET search_path TO public, raw, staging, marts, extensions;

-- 現在のセッションにも適用
SET search_path TO public, raw, staging, marts, extensions;

-- 権限設定（Supabaseのロールにアクセス許可）
GRANT USAGE ON SCHEMA raw TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA staging TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA marts TO anon, authenticated, service_role;

-- 将来作成されるオブジェクトへのデフォルト権限
ALTER DEFAULT PRIVILEGES IN SCHEMA raw GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA marts GRANT SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA raw GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA marts GRANT ALL ON TABLES TO service_role;
