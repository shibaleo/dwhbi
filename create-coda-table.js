const postgres = require('postgres');

const DIRECT_DATABASE_URL = 'postgresql://postgres.liegivvinbwmeujddzif:YWl6jSanQTPjgTsv@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';

async function createTable() {
  const sql = postgres(DIRECT_DATABASE_URL);
  try {
    console.log('Creating raw.coda__table_rows table...');

    await sql`
      CREATE TABLE IF NOT EXISTS raw.coda__table_rows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id TEXT NOT NULL UNIQUE,
        data JSONB NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        api_version TEXT DEFAULT 'v1'
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_coda__table_rows_synced_at
        ON raw.coda__table_rows (synced_at)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_coda__table_rows_data_gin
        ON raw.coda__table_rows USING gin (data)
    `;

    await sql`ALTER TABLE raw.coda__table_rows ENABLE ROW LEVEL SECURITY`;

    // Check if policy exists
    const policies = await sql`
      SELECT policyname FROM pg_policies
      WHERE tablename = 'coda__table_rows' AND schemaname = 'raw'
    `;

    if (policies.length === 0) {
      await sql`
        CREATE POLICY "Service role has full access to coda__table_rows"
          ON raw.coda__table_rows
          FOR ALL
          TO service_role
          USING (true)
          WITH CHECK (true)
      `;
    }

    console.log('Table created successfully!');

    // Verify
    const result = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'raw' AND table_name = 'coda__table_rows'
    `;
    console.log('Verified:', result.length > 0 ? 'OK' : 'FAILED');

  } finally {
    await sql.end();
  }
}

createTable().catch(console.error);
