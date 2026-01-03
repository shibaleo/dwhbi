import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JiraForm } from "./jira-form";

export default async function JiraSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <a
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← 戻る
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          Jira 設定
        </h1>

        <p className="text-zinc-500 dark:text-zinc-400 mb-6">
          MCP経由でJiraにアクセスするための認証情報を設定します。
        </p>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
            API トークンの取得方法
          </h3>
          <ol className="text-sm text-blue-700 dark:text-blue-300 list-decimal list-inside space-y-1">
            <li>
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                Atlassian API Tokens
              </a>
              を開く
            </li>
            <li>「Create API token」をクリック</li>
            <li>ラベルを入力して「Create」</li>
            <li>生成されたトークンをコピー</li>
          </ol>
        </div>

        <JiraForm />
      </main>
    </div>
  );
}
