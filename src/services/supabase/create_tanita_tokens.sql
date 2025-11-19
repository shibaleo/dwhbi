-- ==========================================
-- Tanita Health Planet OAuth2.0トークンテーブル
-- ==========================================
CREATE TABLE tanita_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- OAuth2.0トークン情報
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  
  -- Tanita固有情報
  user_id TEXT,  -- Tanita Health PlanetのユーザーID
  
  -- メタデータ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ,
  
  -- 備考
  notes TEXT
);

-- インデックス
CREATE INDEX idx_tanita_tokens_expires ON tanita_tokens(expires_at);

-- コメント
COMMENT ON TABLE tanita_tokens IS 'Tanita Health Planet OAuth2.0トークン管理';
COMMENT ON COLUMN tanita_tokens.access_token IS 'アクセストークン';
COMMENT ON COLUMN tanita_tokens.refresh_token IS 'リフレッシュトークン（次回更新に使用）';
COMMENT ON COLUMN tanita_tokens.expires_at IS 'アクセストークンの有効期限';
COMMENT ON COLUMN tanita_tokens.last_refreshed_at IS '最後にトークンをリフレッシュした時刻';

-- RLSポリシー（セキュリティ）
ALTER TABLE tanita_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON tanita_tokens
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON tanita_tokens
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON tanita_tokens
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete for authenticated users" ON tanita_tokens
  FOR DELETE USING (auth.role() = 'authenticated');

-- 自動更新トリガー
CREATE OR REPLACE FUNCTION update_tanita_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tanita_tokens_updated_at
  BEFORE UPDATE ON tanita_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_tanita_tokens_updated_at();