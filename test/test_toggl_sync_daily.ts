// test_sync_daily.ts - sync_daily.tsのテストスクリプト

import "https://deno.land/std@0.203.0/dotenv/load.ts";

// --- Environment variables check ---
function checkEnvVariables(): boolean {
  const required = [
    "TOGGL_API_TOKEN",
    "TOGGL_WORKSPACE_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  
  console.log("=".repeat(60));
  console.log("Environment Variables Check");
  console.log("=".repeat(60));
  
  let allPresent = true;
  
  for (const key of required) {
    const value = Deno.env.get(key);
    if (value) {
      const masked = key.includes("KEY") || key.includes("TOKEN") 
        ? `${value.substring(0, 8)}...` 
        : value;
      console.log(`✓ ${key}: ${masked}`);
    } else {
      console.log(`✗ ${key}: NOT SET`);
      allPresent = false;
    }
  }
  
  console.log("=".repeat(60));
  return allPresent;
}

// --- Main test ---
async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  console.log("║              sync_daily.ts Test Suite                     ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");
  
  // Check environment variables
  if (!checkEnvVariables()) {
    console.error("\n❌ Missing required environment variables");
    Deno.exit(1);
  }
  
  console.log("\n✓ All environment variables are set\n");
  
  // Run sync script
  console.log("=".repeat(60));
  console.log("Executing sync_daily.ts");
  console.log("=".repeat(60));
  console.log();
  
  const startTime = Date.now();
  
  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-env",
      "src/services/toggl/sync_daily.ts",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  
  const { code } = await command.output();
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log();
  console.log("=".repeat(60));
  console.log("Test Results");
  console.log("=".repeat(60));
  console.log(`Execution time: ${duration}s`);
  console.log(`Exit code: ${code}`);
  
  if (code === 0) {
    console.log("\n✓ sync_daily.ts completed successfully");
    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║                   TEST PASSED                             ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");
  } else {
    console.log("\n✗ sync_daily.ts failed");
    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║                   TEST FAILED                             ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}