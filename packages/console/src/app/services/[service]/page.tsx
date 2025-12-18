import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { SERVICES, SERVICE_DISPLAY_NAMES, SERVICE_AUTH_TYPES, type ServiceName } from "@/lib/vault";
import { ServiceForm } from "./service-form";

type Params = Promise<{ service: string }>;

// OAuthコールバックURLのパス定義
const OAUTH_CALLBACK_PATHS: Partial<Record<ServiceName, string>> = {
  google_calendar: "/api/oauth/google_calendar/callback",
};

// サービスごとの入力フィールド定義
// required: true の場合、更新時も必ず入力が必要（セットで更新するフィールド）
// multiline: true の場合、複数行入力可能なテキストエリアになる
const SERVICE_FIELDS: Record<ServiceName, { key: string; label: string; type?: string; placeholder?: string; required?: boolean; multiline?: boolean; hint?: string; editable?: boolean }[]> = {
  toggl_track: [
    { key: "api_token", label: "API Token", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", required: true },
  ],
  trello: [
    { key: "api_key", label: "API Key", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", required: true },
    { key: "api_token", label: "API Token", placeholder: "xxxxxxxx...", required: true },
  ],
  airtable: [
    { key: "personal_access_token", label: "Personal Access Token", placeholder: "patXXX..." },
    { key: "base_id", label: "Base ID (オプション)", placeholder: "appXXX..." },
  ],
  fitbit: [
    { key: "client_id", label: "Client ID", placeholder: "XXXXXX" },
    { key: "client_secret", label: "Client Secret", type: "password" },
  ],
  zaim: [
    { key: "consumer_key", label: "Consumer Key" },
    { key: "consumer_secret", label: "Consumer Secret", type: "password" },
  ],
  google_calendar: [
    { key: "client_id", label: "Client ID", placeholder: "xxxxx.apps.googleusercontent.com" },
    { key: "client_secret", label: "Client Secret", type: "password" },
    { key: "calendar_id", label: "Calendar ID (オプション)", placeholder: "自動検出されます" },
  ],
  tanita: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client Secret", type: "password" },
  ],
  ticktick: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client Secret", type: "password" },
  ],
  coda: [
    { key: "api_token", label: "API Token", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", required: true, hint: "https://coda.io/account → API settings で取得" },
    { key: "doc_ids", label: "Doc IDs", placeholder: "AbCdEfGhIj\nKlMnOpQrSt\nUvWxYz1234", multiline: true, hint: "1行に1つのDoc IDを入力（複数可）", editable: true },
  ],
};

export default async function ServicePage({ params }: { params: Params }) {
  const { service } = await params;

  // 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // サービス名の検証
  if (!SERVICES.includes(service as ServiceName)) {
    notFound();
  }

  const serviceName = service as ServiceName;
  const displayName = SERVICE_DISPLAY_NAMES[serviceName];
  const authType = SERVICE_AUTH_TYPES[serviceName];
  const fields = SERVICE_FIELDS[serviceName];

  // OAuthコールバックURLを生成
  let oauthCallbackUrl: string | undefined;
  const callbackPath = OAUTH_CALLBACK_PATHS[serviceName];
  if (callbackPath) {
    const headersList = await headers();
    const host = headersList.get("host") || "localhost:3000";
    const protocol = headersList.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    oauthCallbackUrl = `${protocol}://${host}${callbackPath}`;
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
          {displayName} 設定
        </h1>

        {authType === "api_key" ? (
          <p className="text-zinc-500 dark:text-zinc-400 mb-6">
            API キーを入力して保存してください。
          </p>
        ) : (
          <p className="text-zinc-500 dark:text-zinc-400 mb-6">
            OAuth 認証情報を入力してください。認証後にアクセストークンが自動取得されます。
          </p>
        )}

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            1アカウント / 1ワークスペースのみ対応しています
          </p>
        </div>

        <ServiceForm
          service={serviceName}
          fields={fields}
          authType={authType}
          oauthCallbackUrl={oauthCallbackUrl}
        />
      </main>
    </div>
  );
}
