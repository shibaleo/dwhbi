/**
 * Run SQL migration file
 * Usage: npx tsx src/lib/run-migration.ts path/to/migration.sql
 */

import fs from "fs";
import pg from "pg";
import { config } from "dotenv";

config();

const { Client } = pg;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx src/lib/run-migration.ts <sql-file>");
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, "utf8");
  console.log(`Running migration from: ${filePath}`);

  const client = new Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();

  try {
    await client.query(sql);
    console.log("Migration completed successfully");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
