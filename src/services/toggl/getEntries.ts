import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { TogglReportsEntry } from "./types.ts";

// --- Get environment variables ---
const API_TOKEN = Deno.env.get("TOGGL_API_TOKEN")?.trim();
const WORKSPACE_ID = Deno.env.get("TOGGL_WORKSPACE_ID")?.trim();

if (!API_TOKEN || !WORKSPACE_ID) {
  throw new Error("TOGGL_API_TOKEN or WORKSPACE_ID is not set in .env");
}

// --- Basic authentication header ---
const authHeader = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${API_TOKEN}:api_token`)}`,
};

// --- Toggl Reports API (finished entries) ---
export async function getEntries(startDate: Date, endDate: Date) {
  const url = "https://api.track.toggl.com/reports/api/v2/details";
  let allEntries: any[] = [];
  let page = 1;

  console.log(`Fetching Toggl entries from ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);

  while (true) {
    const params = new URLSearchParams({
      workspace_id: WORKSPACE_ID,
      since: startDate.toISOString().split("T")[0],
      until: endDate.toISOString().split("T")[0],
      user_agent: "toggl-sync-script",
      page: page.toString(),
      per_page: "50",
    });

    const res = await fetch(`${url}?${params}`, { headers: authHeader });

    if (!res.ok) {
      const text = await res.text();
      console.error("Response text:", text);
      throw new Error(`Reports API fetch failed: ${res.status}`);
    }

    const data = await res.json();
    allEntries.push(...data.data);

    console.log(`Fetched ${data.data.length} entries (total so far: ${allEntries.length})`);

    // Stop if all entries have been fetched
    if (allEntries.length >= data.total_count) break;

    page++;
  }

  console.log(`Total entries fetched: ${allEntries.length}`);
  const filtered: TogglReportsEntry[] = allEntries.filter((entry) => {
    const start = new Date(entry.start);
    const end = new Date(entry.end);
    return start.getTime() <= endDate.getTime() && end.getTime() >= startDate.getTime();
  });
  console.log(`Return entries: ${filtered.length}`);
  return filtered;
}

let cachedUsers: any[] = [];
let cachedProjects: any[] = [];
let cachedClients: any[] = [];

async function fetchWorkspaceData() {
  const usersRes = await fetch(
    `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/users`,
    { headers: authHeader }
  );
  if (!usersRes.ok) throw new Error("Failed to fetch users");
  cachedUsers = await usersRes.json();

  const projectsRes = await fetch(
    `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/projects`,
    { headers: authHeader }
  );
  if (!projectsRes.ok) throw new Error("Failed to fetch projects");
  cachedProjects = await projectsRes.json();

  const clientsRes = await fetch(
    `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/clients`,
    { headers: authHeader }
  );
  if (!clientsRes.ok) throw new Error("Failed to fetch clients");
  cachedClients = await clientsRes.json();
}

// --- Current API（進行中エントリー） ---
export async function getCurrentEntry() {
  try {
    const res = await fetch(
      `https://api.track.toggl.com/api/v9/me/time_entries/current`,
      { headers: authHeader }
    );
    if (!res.ok) {
      console.error(await res.text());
      return null;
    }

    const data = await res.json();
    if (!data) return null; // case of no current entry

    const now = new Date();
    const start = new Date(data.start);

    // complete user, project, client info from cached data
    let userName: string | null = null;
    let projectName: string | null = null;
    let clientName: string | null = null;
    let projectColor: string | null = null;
    let projectHexColor: string | null = null;
    if (data.uid) {
      const user = cachedUsers.find((u: any) => u.id === data.uid);
      userName = user?.fullname ?? null;
    }
    if (data.pid) {
      const project = cachedProjects.find((p: any) => p.id === data.pid);
      projectName = project?.name ?? null;
      projectColor = "0";
      projectHexColor = project?.color ?? null;
      const clientId = project?.client_id ?? null;
      if (clientId) {
        const client = cachedClients.find((c: any) => c.id === clientId);
        clientName = client?.name ?? null;
      }
    }
    const result: TogglReportsEntry =  {
      id: data.id,
      pid: data.pid,
      tid: data.tid ?? null,
      uid: data.uid ?? null,
      description: data.description ?? "",
      start: data.start,
      end: now.toISOString(),
      updated: now.toISOString(),
      dur: now.getTime() - start.getTime(),
      user: userName ?? null,
      use_stop: false,
      client: clientName ?? null,
      project: projectName ?? null,
      project_color: projectColor ?? "0",
      project_hex_color: projectHexColor ?? null,
      billable: 0,
      is_billable: false,
      cur: "USD",
      tags: []
    };

    return result;
  } catch (err) {
    console.error("Error fetching current entry:", err);
    return null;
  }
}

export async function getLatestEntries(){
  await fetchWorkspaceData();
  const url = "https://api.track.toggl.com/reports/api/v2/details";
  let allEntries: any[] = [];
  let page = 1;
  const now = new Date();

  while (true) {
    const params = new URLSearchParams({
      workspace_id: WORKSPACE_ID,
      since: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // past 1 day
      until: new Date().toISOString().split("T")[0],
      user_agent: "toggl-sync-script",
      page: page.toString(),
      per_page: "50",
    });

    const res = await fetch(`${url}?${params}`, { headers: authHeader });

    if (!res.ok) {
      const text = await res.text();
      console.error("Response text:", text);
      throw new Error(`Reports API fetch failed: ${res.status}`);
    }

    const data = await res.json();
    allEntries.push(...data.data);

    console.log(`Fetched ${data.data.length} entries (total so far: ${allEntries.length})`);

    // Stop if all entries have been fetched
    if (allEntries.length >= data.total_count) break;

    page++;
  }
  const latest = await getCurrentEntry();
  if(latest){
    allEntries.push(latest);
  }
  console.log(`Total entries fetched: ${allEntries.length}`);
  const reversed = allEntries.sort((a, b) => {
    const dateA = new Date(a.start).getTime();
    const dateB = new Date(b.start).getTime();
    return dateB - dateA;
  });
  return reversed.slice(0, 3); // return latest 20 entries

}

// --- Example execution ---
if (import.meta.main) {
  await fetchWorkspaceData();
  const start = new Date("2025-09-25T00:00:00+09:00");
  const end = new Date("2025-09-25T23:59:59+09:00");

  //const entries = await getEntries(start, end);
  //const entries = await getCurrentEntry();
  const entries = await getLatestEntries();
  entries.forEach((entry) => {
    console.log(entry.client, entry.project, entry.description);
  });
}