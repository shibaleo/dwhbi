import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.DIRECT_DATABASE_URL);

try {
  // Check if there's a toggl projects table in raw schema
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'raw' 
      AND table_name LIKE '%toggl%project%'
    ORDER BY table_name
  `;
  console.log("Toggl project related tables in raw schema:");
  console.log(tables);

  // Check staging layer
  const stgTables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'staging' 
      AND table_name LIKE '%toggl%project%'
    ORDER BY table_name
  `;
  console.log("\nToggl project related tables in staging schema:");
  console.log(stgTables);

  // Check core layer
  const coreTables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'core' 
      AND table_name LIKE '%project%'
    ORDER BY table_name
  `;
  console.log("\nProject related tables in core schema:");
  console.log(coreTables);

  // If there's a raw toggl projects table, show its structure
  if (tables.length > 0) {
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'raw' 
        AND table_name = ${tables[0].table_name}
      ORDER BY ordinal_position
    `;
    console.log(`\nColumns in raw.${tables[0].table_name}:`);
    console.log(cols);
  }
} finally {
  await sql.end();
}
