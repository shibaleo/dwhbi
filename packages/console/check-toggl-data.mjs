import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.DIRECT_DATABASE_URL);

try {
  // Check toggl_track__projects (direct from Toggl API)
  const togglProjects = await sql`
    SELECT source_id, data
    FROM raw.toggl_track__projects
    LIMIT 3
  `;
  console.log("raw.toggl_track__projects (from Toggl API):");
  for (const p of togglProjects) {
    console.log("  " + p.source_id + ":", p.data);
  }

  // Check coda__mst_toggl_projects (from Coda)
  const codaProjects = await sql`
    SELECT source_id, data
    FROM raw.coda__mst_toggl_projects
    LIMIT 3
  `;
  console.log("\nraw.coda__mst_toggl_projects (from Coda):");
  for (const p of codaProjects) {
    console.log("  " + p.source_id + ":", p.data);
  }

  // Count records
  const togglCount = await sql`SELECT COUNT(*) as cnt FROM raw.toggl_track__projects`;
  const codaCount = await sql`SELECT COUNT(*) as cnt FROM raw.coda__mst_toggl_projects`;
  console.log("\nRecord counts:");
  console.log("  toggl_track__projects: " + togglCount[0].cnt);
  console.log("  coda__mst_toggl_projects: " + codaCount[0].cnt);
} finally {
  await sql.end();
}
