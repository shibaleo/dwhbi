// test_toggl_fetch_metadata.ts - clients, projects, tags の取得をテストする

import { fetchClientsWithRetry } from "../src/services/toggl/fetch_clients.ts";
import { fetchProjectsWithRetry } from "../src/services/toggl/fetch_projects.ts";
import { fetchTagsWithRetry } from "../src/services/toggl/fetch_tags.ts";

async function testFetchClients() {
  console.log("=".repeat(50));
  console.log("Testing: fetchClientsWithRetry");
  console.log("=".repeat(50));
  
  try {
    const clients = await fetchClientsWithRetry();
    
    console.log(`✓ Successfully fetched ${clients.length} clients\n`);
    
    console.log("Clients summary:");
    const activeClients = clients.filter(c => !c.archived);
    const archivedClients = clients.filter(c => c.archived);
    
    console.log(`  Active: ${activeClients.length}`);
    console.log(`  Archived: ${archivedClients.length}\n`);
    
    console.log("Client details:");
    clients.forEach(client => {
      const status = client.archived ? "[ARCHIVED]" : "[ACTIVE]";
      console.log(`  ${status} ${client.name} (ID: ${client.id})`);
    });
    
    return clients;
    
  } catch (error) {
    console.error("✗ Failed to fetch clients:", error);
    throw error;
  }
}

async function testFetchProjects() {
  console.log("\n" + "=".repeat(50));
  console.log("Testing: fetchProjectsWithRetry");
  console.log("=".repeat(50));
  
  try {
    const projects = await fetchProjectsWithRetry(true); // include archived
    
    console.log(`✓ Successfully fetched ${projects.length} projects\n`);
    
    console.log("Projects summary:");
    const activeProjects = projects.filter(p => p.active !== false);
    const archivedProjects = projects.filter(p => p.active === false);
    
    console.log(`  Active: ${activeProjects.length}`);
    console.log(`  Archived: ${archivedProjects.length}\n`);
    
    // Group by client
    const byClient = new Map<number | null, typeof projects>();
    projects.forEach(project => {
      const clientId = project.client_id ?? null;
      if (!byClient.has(clientId)) {
        byClient.set(clientId, []);
      }
      byClient.get(clientId)!.push(project);
    });
    
    console.log("Projects by client:");
    byClient.forEach((projects, clientId) => {
      const clientLabel = clientId === null ? "No Client" : `Client ID: ${clientId}`;
      console.log(`\n  ${clientLabel} (${projects.length} projects):`);
      projects.forEach(p => {
        const status = p.active === false ? "[ARCHIVED]" : "[ACTIVE]";
        const billable = p.billable ? "[BILLABLE]" : "";
        console.log(`    ${status} ${p.name} ${billable}`);
      });
    });
    
    return projects;
    
  } catch (error) {
    console.error("✗ Failed to fetch projects:", error);
    throw error;
  }
}

async function testFetchActiveProjectsOnly() {
  console.log("\n" + "=".repeat(50));
  console.log("Testing: fetchProjectsWithRetry (active only)");
  console.log("=".repeat(50));
  
  try {
    const projects = await fetchProjectsWithRetry(false); // exclude archived
    
    console.log(`✓ Successfully fetched ${projects.length} active projects\n`);
    
    console.log("Active projects:");
    projects.forEach(p => {
      const billable = p.billable ? "[BILLABLE]" : "";
      console.log(`  - ${p.name} ${billable}`);
    });
    
    return projects;
    
  } catch (error) {
    console.error("✗ Failed to fetch active projects:", error);
    throw error;
  }
}

async function testFetchTags() {
  console.log("\n" + "=".repeat(50));
  console.log("Testing: fetchTagsWithRetry");
  console.log("=".repeat(50));
  
  try {
    const tags = await fetchTagsWithRetry();
    
    console.log(`✓ Successfully fetched ${tags.length} tags\n`);
    
    if (tags.length === 0) {
      console.log("  No tags found in workspace");
      return tags;
    }
    
    console.log("Tags summary:");
    console.log(`  Total tags: ${tags.length}\n`);
    
    // Analyze tag patterns
    const tagPatterns = new Map<string, number>();
    tags.forEach(tag => {
      const prefix = tag.name.includes(':') ? tag.name.split(':')[0] : 'no-prefix';
      tagPatterns.set(prefix, (tagPatterns.get(prefix) || 0) + 1);
    });
    
    console.log("Tag patterns (by prefix):");
    Array.from(tagPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([prefix, count]) => {
        console.log(`  ${prefix}: ${count} tags`);
      });
    
    console.log("\nAll tags:");
    tags.forEach(tag => {
      console.log(`  [${tag.id}] ${tag.name}`);
    });
    
    // Show sample tag structure
    if (tags.length > 0) {
      console.log("\nSample tag structure:");
      console.log(JSON.stringify(tags[0], null, 2));
    }
    
    return tags;
    
  } catch (error) {
    console.error("✗ Failed to fetch tags:", error);
    throw error;
  }
}

// --- Main test execution ---
if (import.meta.main) {
  console.log("Starting metadata fetch tests...\n");
  
  try {
    // Test clients fetch
    const clients = await testFetchClients();
    
    // Test projects fetch (all)
    const projects = await testFetchProjects();
    
    // Test projects fetch (active only)
    const activeProjects = await testFetchActiveProjectsOnly();
    
    // Test tags fetch
    const tags = await testFetchTags();
    
    // Final summary
    console.log("\n" + "=".repeat(50));
    console.log("All tests completed successfully!");
    console.log("=".repeat(50));
    console.log(`Total clients: ${clients.length}`);
    console.log(`Total projects: ${projects.length}`);
    console.log(`Active projects: ${activeProjects.length}`);
    console.log(`Total tags: ${tags.length}`);
    console.log("=".repeat(50));
    
  } catch (error) {
    console.error("\n" + "=".repeat(50));
    console.error("Test failed!");
    console.error("=".repeat(50));
    console.error(error);
    Deno.exit(1);
  }
}