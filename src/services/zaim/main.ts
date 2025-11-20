// zaim/main.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { ZaimSupabaseSync } from "./sync.ts";

async function main() {
  const userId = Deno.env.get("USER_ID");
  
  if (!userId) {
    console.error("USER_ID environment variable is required");
    Deno.exit(1);
  }

  const sync = new ZaimSupabaseSync(userId);

  const args = Deno.args;
  const command = args[0] || "full";

  try {
    switch (command) {
      case "full":
        await sync.fullSync();
        break;
      case "categories":
        await sync.syncCategories();
        break;
      case "genres":
        await sync.syncGenres();
        break;
      case "accounts":
        await sync.syncAccounts();
        break;
      case "transactions":
        const startDate = args[1];
        const endDate = args[2];
        await sync.syncTransactions(startDate, endDate);
        break;
      default:
        console.log("Usage: deno run --allow-net --allow-env main.ts [command]");
        console.log("Commands: full, categories, genres, accounts, transactions [start_date] [end_date]");
        Deno.exit(1);
    }
  } catch (error) {
    console.error("Error:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}