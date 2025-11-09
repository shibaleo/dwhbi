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
 * Fetch all projects from Toggl workspace
 */
async function fetchTogglProjects() {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/projects`;
  
  console.log("Fetching Toggl projects...");
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    console.error("Response text:", text);
    throw new Error(`Failed to fetch projects: ${res.status}`);
  }
  
  const projects = await res.json();
  console.log(`Fetched ${projects.length} projects from Toggl`);
  
  return projects;
}

/**
 * Fetch all clients to get client names
 */
async function fetchTogglClients() {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/clients`;
  
  console.log("Fetching Toggl clients for reference...");
  
  const res = await fetch(url, { headers: authHeader });
  
  if (!res.ok) {
    const text = await res.text();
    console.error("Response text:", text);
    throw new Error(`Failed to fetch clients: ${res.status}`);
  }
  
  const clients = await res.json();
  console.log(`Fetched ${clients.length} clients from Toggl`);
  
  // Create a map of client ID to client name
  const clientMap = new Map();
  clients.forEach(client => {
    clientMap.set(client.id, client.name);
  });
  
  return clientMap;
}

/**
 * Fetch project statistics from Reports API
 */
async function fetchProjectStatistics(projectId: number): Promise<{ actual_hours: number; actual_seconds: number; total_count: number }> {
  const url = "https://api.track.toggl.com/reports/api/v2/summary";
  
  // Get data for the entire project history (use a wide date range)
  const params = new URLSearchParams({
    workspace_id: WORKSPACE_ID,
    project_ids: projectId.toString(),
    since: "2020-01-01",
    until: new Date().toISOString().split("T")[0],
    user_agent: "toggl-sync-script",
  });
  
  const res = await fetch(`${url}?${params}`, { headers: authHeader });
  
  if (!res.ok) {
    // Reports API might fail for free plan or rate limit
    console.warn(`Could not fetch statistics for project ${projectId}`);
    return { actual_hours: 0, actual_seconds: 0, total_count: 0 };
  }
  
  const data = await res.json();
  
  if (data.data && data.data.length > 0 && data.data[0].items && data.data[0].items.length > 0) {
    const projectData = data.data[0].items[0];
    const seconds = projectData.time || 0;
    const hours = Math.floor(seconds / 3600);
    const count = projectData.count || 0;
    
    return { 
      actual_hours: hours, 
      actual_seconds: seconds,
      total_count: count
    };
  }
  
  return { actual_hours: 0, actual_seconds: 0, total_count: 0 };
}

/**
 * Transform Toggl project to database format
 */
function transformProjectForDB(project: any, clientName: string | null, stats: any) {
  return {
    id: project.id,
    workspace_id: project.wid || project.workspace_id,
    client_id: project.client_id || project.cid || null,
    name: project.name,
    is_private: project.is_private || false,
    active: project.active !== false, // Default to true if not specified
    at: project.at,
    created_at: project.created_at || project.at,
    server_deleted_at: project.server_deleted_at || null,
    color: project.color || project.hex_color,
    billable: project.billable || false,
    template: project.template || null,
    auto_estimates: project.auto_estimates || null,
    estimated_hours: project.estimated_hours || null,
    estimated_seconds: project.estimated_seconds || null,
    rate: project.rate || null,
    rate_last_updated: project.rate_last_updated || null,
    currency: project.currency || null,
    recurring: project.recurring || false,
    template_id: project.template_id || null,
    recurring_parameters: project.recurring_parameters || null,
    fixed_fee: project.fixed_fee || null,
    actual_hours: stats.actual_hours,
    actual_seconds: stats.actual_seconds,
    total_count: stats.total_count,
    client_name: clientName,
    can_track_time: project.can_track_time !== false, // Default to true
    start_date: project.start_date || project.created_at?.split('T')[0] || null,
    status: project.active === false ? 'archived' : 'active',
    wid: project.wid || project.workspace_id,
    cid: project.client_id || project.cid || null,
    pinned: project.pinned || false,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Upsert projects to Supabase
 */
async function upsertProjectsToSupabase(projects: any[], clientMap: Map<number, string>) {
  if (projects.length === 0) {
    console.log("No projects to upsert");
    return 0;
  }
  
  console.log(`\nProcessing ${projects.length} projects...`);
  
  const rows = [];
  let processedCount = 0;
  
  // Process each project with statistics
  for (const project of projects) {
    processedCount++;
    console.log(`  Processing ${processedCount}/${projects.length}: ${project.name}`);
    
    // Get client name
    const clientName = project.client_id ? clientMap.get(project.client_id) : null;
    
    // Try to get statistics (might fail for rate limit)
    let stats = { actual_hours: 0, actual_seconds: 0, total_count: 0 };
    try {
      // Skip statistics for now to avoid rate limit
      // Uncomment if you have a paid plan or want to try
      // stats = await fetchProjectStatistics(project.id);
      // await new Promise(resolve => setTimeout(resolve, 500)); // Delay to avoid rate limit
    } catch (error) {
      console.warn(`    Could not fetch stats for ${project.name}`);
    }
    
    // Transform to database format
    const dbRow = transformProjectForDB(project, clientName, stats);
    rows.push(dbRow);
  }
  
  console.log(`\nUpserting ${rows.length} projects to Supabase...`);
  
  // Upsert to Supabase in chunks
  const chunkSize = 50;
  let totalUpserted = 0;
  
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    
    const { data, error } = await supabase
      .from("toggl_projects")
      .upsert(chunk, {
        onConflict: "id",
        ignoreDuplicates: false,
      })
      .select();
    
    if (error) {
      console.error(`Error upserting chunk ${Math.floor(i / chunkSize) + 1}:`, error);
      throw error;
    }
    
    totalUpserted += data?.length || chunk.length;
    console.log(`  ✓ Chunk ${Math.floor(i / chunkSize) + 1}: upserted ${chunk.length} projects`);
  }
  
  // Display summary by client
  console.log("\n✓ Projects by client:");
  const projectsByClient = new Map<string, number>();
  rows.forEach(project => {
    const clientName = project.client_name || "No Client";
    projectsByClient.set(clientName, (projectsByClient.get(clientName) || 0) + 1);
  });
  
  Array.from(projectsByClient.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([client, count]) => {
      console.log(`  - ${client}: ${count} projects`);
    });
  
  return totalUpserted;
}

/**
 * Main sync function
 */
async function syncProjectsToSupabase() {
  console.log("====================================");
  console.log("Starting Toggl Projects Sync");
  console.log(`Workspace ID: ${WORKSPACE_ID}`);
  console.log("====================================\n");
  
  try {
    // Fetch clients first (for client names)
    const clientMap = await fetchTogglClients();
    
    // Add small delay to avoid rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Fetch projects from Toggl
    const projects = await fetchTogglProjects();
    
    // Upsert to Supabase
    const count = await upsertProjectsToSupabase(projects, clientMap);
    
    console.log("\n====================================");
    console.log("Sync completed successfully!");
    console.log(`Total projects synced: ${count}`);
    console.log("====================================");
    
  } catch (error) {
    console.error("Sync failed:", error);
    throw error;
  }
}

// Execute main sync
if (import.meta.main) {
  try {
    await syncProjectsToSupabase();
  } catch (error) {
    console.error("Fatal error:", error);
    Deno.exit(1);
  }
}