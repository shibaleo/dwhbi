import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ServiceList } from "@/components/service-list";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
          <ServiceList />
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
