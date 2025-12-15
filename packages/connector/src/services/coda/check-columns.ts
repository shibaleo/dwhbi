#!/usr/bin/env npx tsx
/**
 * Check Coda table columns
 * Usage: npx tsx src/services/coda/check-columns.ts
 */

import { getAuthInfo } from "./api-client.js";

const CODA_API_BASE = "https://coda.io/apis/v1";
const DOC_ID = "otJmZmksOC";

const TABLES = {
  "mst_personal_time_category": "grid-1a2cLMloN0",
  "mst_social_time_category": "grid-qqVwHqBfCz",
  "mst_toggl_projects": "grid-LxGswbLt-q",
  "mst_coarse_personal_time_category": "grid-???", // Need to find this
};

async function main() {
  const auth = await getAuthInfo();

  // First, list all tables to find the new one
  console.log("=== All Tables ===");
  const tablesUrl = `${CODA_API_BASE}/docs/${DOC_ID}/tables`;
  const tablesResponse = await fetch(tablesUrl, { headers: auth.headers });
  const tablesData = await tablesResponse.json() as { items: { id: string; name: string }[] };

  for (const table of tablesData.items) {
    console.log(`  ${table.id}: ${table.name}`);
  }

  console.log("\n=== Columns for key tables ===");

  // Check mst_personal_time_category columns
  const personalUrl = `${CODA_API_BASE}/docs/${DOC_ID}/tables/grid-1a2cLMloN0/columns`;
  const personalResponse = await fetch(personalUrl, { headers: auth.headers });
  const personalData = await personalResponse.json() as { items: { id: string; name: string; format?: { type: string } }[] };

  console.log("\nmst_personal_time_category:");
  for (const col of personalData.items) {
    console.log(`  ${col.id}: ${col.name} (${col.format?.type || "unknown"})`);
  }

  // Check mst_social_time_category columns
  const socialUrl = `${CODA_API_BASE}/docs/${DOC_ID}/tables/grid-qqVwHqBfCz/columns`;
  const socialResponse = await fetch(socialUrl, { headers: auth.headers });
  const socialData = await socialResponse.json() as { items: { id: string; name: string; format?: { type: string } }[] };

  console.log("\nmst_social_time_category:");
  for (const col of socialData.items) {
    console.log(`  ${col.id}: ${col.name} (${col.format?.type || "unknown"})`);
  }

  // Check mst_toggl_projects columns
  const projectsUrl = `${CODA_API_BASE}/docs/${DOC_ID}/tables/grid-LxGswbLt-q/columns`;
  const projectsResponse = await fetch(projectsUrl, { headers: auth.headers });
  const projectsData = await projectsResponse.json() as { items: { id: string; name: string; format?: { type: string } }[] };

  console.log("\nmst_toggl_projects:");
  for (const col of projectsData.items) {
    console.log(`  ${col.id}: ${col.name} (${col.format?.type || "unknown"})`);
  }

  // Check mst_coarse_personal_time_category columns
  const coarseUrl = `${CODA_API_BASE}/docs/${DOC_ID}/tables/grid-N8i-IPxGVf/columns`;
  const coarseResponse = await fetch(coarseUrl, { headers: auth.headers });
  const coarseData = await coarseResponse.json() as { items: { id: string; name: string; format?: { type: string } }[] };

  console.log("\nmst_coarse_personal_time_category:");
  for (const col of coarseData.items) {
    console.log(`  ${col.id}: ${col.name} (${col.format?.type || "unknown"})`);
  }
}

main().catch(console.error);
