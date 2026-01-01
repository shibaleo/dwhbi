"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AuthorizationDetails {
  client?: {
    name?: string;
    icon_uri?: string;
  };
  redirect_uri?: string;
  scopes?: string[];
}

function OAuthConsentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [authDetails, setAuthDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  const authorizationId = searchParams.get("authorization_id");

  useEffect(() => {
    async function fetchAuthorizationDetails() {
      if (!authorizationId) {
        setError("authorization_id が見つかりません");
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // Check if user is logged in
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setNeedsLogin(true);
        setLoading(false);
        return;
      }

      try {
        const { data, error: authError } = await supabase.auth.oauth.getAuthorizationDetails(
          authorizationId
        );

        if (authError) {
          setError(authError.message);
          setLoading(false);
          return;
        }

        setAuthDetails(data as AuthorizationDetails);
      } catch (err) {
        setError(err instanceof Error ? err.message : "認証情報の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    }

    fetchAuthorizationDetails();
  }, [authorizationId]);

  const handleApprove = async () => {
    if (!authorizationId) return;

    setProcessing(true);
    const supabase = createClient();

    try {
      const { data, error: approveError } = await supabase.auth.oauth.approveAuthorization(
        authorizationId
      );

      if (approveError) {
        setError(approveError.message);
        setProcessing(false);
        return;
      }

      if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "承認処理に失敗しました");
      setProcessing(false);
    }
  };

  const handleDeny = async () => {
    if (!authorizationId) return;

    setProcessing(true);
    const supabase = createClient();

    try {
      const { data, error: denyError } = await supabase.auth.oauth.denyAuthorization(
        authorizationId
      );

      if (denyError) {
        setError(denyError.message);
        setProcessing(false);
        return;
      }

      if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "拒否処理に失敗しました");
      setProcessing(false);
    }
  };

  const handleLogin = () => {
    // Redirect to login with return URL
    const returnUrl = `/auth/consent?authorization_id=${authorizationId}`;
    router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <p className="text-zinc-500 dark:text-zinc-400">読み込み中...</p>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 px-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-lg shadow-lg p-6">
          <h1 className="text-xl font-semibold text-center text-zinc-900 dark:text-zinc-100 mb-4">
            ログインが必要です
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-center mb-6">
            アプリケーションへのアクセスを許可するには、まずログインしてください。
          </p>
          <button
            onClick={handleLogin}
            className="w-full py-2 px-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
          >
            ログインする
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 px-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-lg shadow-lg p-6">
          <h1 className="text-xl font-semibold text-center text-red-600 dark:text-red-400 mb-4">
            エラー
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-center">{error}</p>
        </div>
      </div>
    );
  }

  if (!authDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 px-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-lg shadow-lg p-6">
          <p className="text-zinc-600 dark:text-zinc-400 text-center">
            認証情報が見つかりません
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
          {authDetails.client?.icon_uri && (
            <img
              src={authDetails.client.icon_uri}
              alt={authDetails.client?.name || "App"}
              className="w-16 h-16 mx-auto mb-4 rounded-lg"
            />
          )}
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            アクセスの許可
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {authDetails.client?.name || "アプリケーション"}
            </span>
            {" "}があなたのアカウントへのアクセスを要求しています
          </p>
        </div>

        {authDetails.scopes && authDetails.scopes.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              このアプリは以下の権限を要求しています:
            </h2>
            <ul className="space-y-2">
              {authDetails.scopes.map((scope) => (
                <li
                  key={scope}
                  className="flex items-center text-sm text-zinc-600 dark:text-zinc-400"
                >
                  <svg
                    className="w-4 h-4 mr-2 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {scope}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleApprove}
            disabled={processing}
            className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "処理中..." : "許可する"}
          </button>
          <button
            onClick={handleDeny}
            disabled={processing}
            className="w-full py-2 px-4 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "処理中..." : "拒否する"}
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-500 text-center mt-4">
          許可すると、{authDetails.client?.name || "アプリケーション"} はあなたのアカウント情報にアクセスできるようになります。
        </p>
      </div>
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-900">
          <p className="text-zinc-500 dark:text-zinc-400">読み込み中...</p>
        </div>
      }
    >
      <OAuthConsentContent />
    </Suspense>
  );
}
