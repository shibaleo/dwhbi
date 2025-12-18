import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.DIRECT_DATABASE_URL);

try {
  // Check current table structure
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'raw' 
      AND table_name = 'coda__time_intent_pattern_entries'
    ORDER BY ordinal_position
  `;
  console.log("Current entries table columns:");
  console.log(cols);
  
  // Check if there's data
  const count = await sql`
    SELECT COUNT(*) as cnt FROM raw.coda__time_intent_pattern_entries
  `;
  console.log("\nEntry count:", count[0].cnt);
} finally {
  await sql.end();
}
