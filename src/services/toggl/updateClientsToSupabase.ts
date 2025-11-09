import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// --- Get environment variables ---
const API_TOKEN = Deno.env.get("TOGGL_API_TOKEN")?.trim();
const WORKSPACE_ID = Deno.env.get("TOGGL_WORKSPACE_ID")?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!API_TOKEN || !WORKSPACE_ID) {
  throw new Error("TOGGL_API_TOKEN or WORKSPACE_ID is not set in .env");
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in .env");
}

// --- Basic authentication header for Toggl ---
const authHeader = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${API_TOKEN}:api_token`)}`,
};

// --- Create Supabase client ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Fetch all clients from Toggl workspace
 */
async function fetchTogglClients() {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/clients`;
  
  console.log("Fetching Toggl clients...");
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    console.error("Response text:", text);
    throw new Error(`Failed to fetch clients: ${res.status}`);
  }
  
  const clients = await res.json();
  console.log(`Fetched ${clients.length} clients from Toggl`);
  
  return clients;
}

/**
 * Count projects for each client
 */
async function fetchProjectCounts(): Promise<Map<number, number>> {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/projects`;
  
  console.log("Fetching project counts...");
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    console.error("Response text:", text);
    throw new Error(`Failed to fetch projects: ${res.status}`);
  }
  
  const projects = await res.json();
  
  // Count projects per client
  const clientProjectCount = new Map<number, number>();
  
  for (const project of projects) {
    if (project.client_id) {
      const currentCount = clientProjectCount.get(project.client_id) || 0;
      clientProjectCount.set(project.client_id, currentCount + 1);
    }
  }
  
  console.log(`Counted projects for ${clientProjectCount.size} clients`);
  
  return clientProjectCount;
}

/**
 * Transform Toggl client to database format
 */
function transformClientForDB(client: any, projectCount: number) {
  return {
    id: client.id,
    wid: client.wid,
    archived: client.archived || false,
    name: client.name,
    at: client.at,
    creator_id: client.creator_id || null,
    total_count: projectCount,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Upsert clients to Supabase
 */
async function upsertClientsToSupabase(clients: any[], projectCounts: Map<number, number>) {
  if (clients.length === 0) {
    console.log("No clients to upsert");
    return 0;
  }
  
  console.log(`\nUpserting ${clients.length} clients to Supabase...`);
  
  // Transform clients to database format
  const rows = clients.map(client => {
    const projectCount = projectCounts.get(client.id) || 0;
    return transformClientForDB(client, projectCount);
  });
  
  // Upsert to Supabase
  const { data, error } = await supabase
    .from("toggl_clients")
    .upsert(rows, {
      onConflict: "id",
      ignoreDuplicates: false,
    })
    .select();
  
  if (error) {
    console.error("Error upserting clients:", error);
    throw error;
  }
  
  // Display results
  console.log("\n✓ Successfully upserted clients:");
  rows.forEach(client => {
    console.log(`  - ${client.name}: ${client.total_count} projects`);
  });
  
  return data?.length || rows.length;
}

/**
 * Main sync function
 */
async function syncClientsToSupabase() {
  console.log("====================================");
  console.log("Starting Toggl Clients Sync");
  console.log(`Workspace ID: ${WORKSPACE_ID}`);
  console.log("====================================\n");
  
  try {
    // Fetch clients from Toggl
    const clients = await fetchTogglClients();
    
    // Fetch project counts
    const projectCounts = await fetchProjectCounts();
    
    // Upsert to Supabase
    const count = await upsertClientsToSupabase(clients, projectCounts);
    
    console.log("\n====================================");
    console.log("Sync completed successfully!");
    console.log(`Total clients synced: ${count}`);
    console.log("====================================");
    
  } catch (error) {
    console.error("Sync failed:", error);
    throw error;
  }
}

// Execute main sync
if (import.meta.main) {
  try {
    await syncClientsToSupabase();
  } catch (error) {
    console.error("Fatal error:", error);
    Deno.exit(1);
  }
}