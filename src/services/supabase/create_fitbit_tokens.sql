CREATE TABLE fitbit_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- トークン情報
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  
  -- 有効期限
  expires_at TIMESTAMPTZ NOT NULL,
  
  -- スコープ
  scope TEXT,
  
  -- Fitbit user ID
  user_fitbit_id TEXT,
  
  -- メタデータ
  metadata JSONB,
  
  -- 監査
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ,
  
  -- 単一レコードのみ許可（個人使用）
  CONSTRAINT single_record CHECK (id = id)
);

-- 単一レコード制約の実装
CREATE UNIQUE INDEX single_fitbit_token ON fitbit_tokens ((true));

-- 更新日時の自動更新
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_fitbit_tokens_updated_at
  BEFORE UPDATE ON fitbit_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX idx_fitbit_tokens_expires_at ON fitbit_tokens(expires_at);

-- Row Level Security
ALTER TABLE fitbit_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service account only"
  ON fitbit_tokens
  FOR ALL
  USING (auth.role() = 'service_role');