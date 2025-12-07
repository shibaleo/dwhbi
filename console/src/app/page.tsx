import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ServiceList } from "@/components/service-list";
import { hasGitHubConfig } from "@/lib/vault";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const githubConfigured = await hasGitHubConfig();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            LIFETRACER Admin
          </h1>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <section className="mb-8">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
            連携サービス
          </h2>
          <ServiceList githubConfigured={githubConfigured} />
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
            システム設定
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <a
              href="/settings/github"
              className="block bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                    GitHub
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    同期実行用の PAT 設定
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  githubConfigured
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                }`}>
                  {githubConfigured ? "設定済み" : "未設定"}
                </span>
              </div>
            </a>
            {githubConfigured && (
              <a
                href="/settings/github/usage"
                className="block bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                      Actions 使用量
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      今月の GitHub Actions 使用時間
                    </p>
                  </div>
                  <span className="text-zinc-400 dark:text-zinc-500">
                    →
                  </span>
                </div>
              </a>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
            最終同期結果
          </h2>
          <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">
              同期履歴はまだありません
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
