import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UsageDisplay } from "./usage-display";

export default async function GitHubUsagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <a
            href="/"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← 戻る
          </a>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            GitHub Actions 使用量
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <UsageDisplay />
      </main>
    </div>
  );
}
