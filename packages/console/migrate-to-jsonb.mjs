import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.DIRECT_DATABASE_URL);

try {
  await sql.begin(async (tx) => {
    // 1. Drop entries table
    await tx`DROP TABLE IF EXISTS raw.coda__time_intent_pattern_entries`;
    console.log("Dropped entries table");

    // 2. Drop existing versions and recreate with JSONB
    await tx`DROP TABLE IF EXISTS raw.coda__time_intent_pattern_versions`;
    console.log("Dropped versions table");

    // 3. Create new versions table with JSONB entries
    await tx`
      CREATE TABLE raw.coda__time_intent_pattern_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pattern_type TEXT NOT NULL,
        version_number TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        entries JSONB NOT NULL DEFAULT '[]'::jsonb,
        valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
        valid_to TIMESTAMPTZ,
        UNIQUE(pattern_type, version_number)
      )
    `;
    console.log("Created new versions table with JSONB entries column");
  });

  console.log("\nMigration completed successfully!");
  
  // Verify table structure
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'raw' 
      AND table_name = 'coda__time_intent_pattern_versions'
    ORDER BY ordinal_position
  `;
  console.log("\nNew table structure:");
  console.log(cols);
} catch (err) {
  console.error("Migration failed:", err);
} finally {
  await sql.end();
}
