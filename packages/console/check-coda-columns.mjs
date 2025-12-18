import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.DIRECT_DATABASE_URL);
const CODA_DOC_ID = "otJmZmksOC";
const MST_TOGGL_PROJECTS_TABLE_ID = "grid-LxGswbLt-q";

try {
  // Get Coda API token
  const rows = await sql`
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'coda'
  `;
  const secret = JSON.parse(rows[0].decrypted_secret);
  const apiToken = secret.api_token;

  // Fetch columns from mst_toggl_projects table
  const colRes = await fetch(
    `https://coda.io/apis/v1/docs/${CODA_DOC_ID}/tables/${MST_TOGGL_PROJECTS_TABLE_ID}/columns`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const colData = await colRes.json();
  
  console.log("Columns in mst_toggl_projects:");
  for (const col of colData.items) {
    console.log(`  ${col.id}: ${col.name}`);
  }

  // Fetch a few rows to see the data
  const rowRes = await fetch(
    `https://coda.io/apis/v1/docs/${CODA_DOC_ID}/tables/${MST_TOGGL_PROJECTS_TABLE_ID}/rows?limit=3&valueFormat=rich`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const rowData = await rowRes.json();
  
  console.log("\nSample row values:");
  if (rowData.items[0]) {
    console.log(JSON.stringify(rowData.items[0].values, null, 2));
  }
} finally {
  await sql.end();
}
