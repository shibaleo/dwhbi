"use client";

import { useState, useEffect } from "react";

interface JiraConfigState {
  configured: boolean;
  email: string;
  api_token: string;
  domain: string;
}

export function JiraForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [config, setConfig] = useState<JiraConfigState>({
    configured: false,
    email: "",
    api_token: "",
    domain: "",
  });

  const [formEmail, setFormEmail] = useState("");
  const [formApiToken, setFormApiToken] = useState("");
  const [formDomain, setFormDomain] = useState("");

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch("/api/jira");
      if (!res.ok) throw new Error("Failed to fetch config");
      const data = await res.json();
      setConfig(data);
      if (data.configured) {
        setFormEmail(data.email);
        setFormDomain(data.domain);
      }
    } catch {
      setError("設定の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    if (!formEmail || !formApiToken || !formDomain) {
      setError("すべてのフィールドを入力してください");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formEmail,
          api_token: formApiToken,
          domain: formDomain,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setSuccess("保存しました");
      await fetchConfig();
      setFormApiToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Jira 設定を削除しますか？")) return;

    setError(null);
    setSuccess(null);
    setDeleting(true);

    try {
      const res = await fetch("/api/jira", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");

      setSuccess("設定を削除しました");
      setConfig({ configured: false, email: "", api_token: "", domain: "" });
      setFormEmail("");
      setFormApiToken("");
      setFormDomain("");
    } catch {
      setError("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-500 dark:text-zinc-400">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      {config.configured && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-200">
            設定済み
          </p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            Email: {config.email}
          </p>
          <p className="text-xs text-green-600 dark:text-green-400">
            Domain: {config.domain}
          </p>
          <p className="text-xs text-green-600 dark:text-green-400">
            API Token: {config.api_token}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Jira Domain
          </label>
          <input
            type="text"
            value={formDomain}
            onChange={(e) => setFormDomain(e.target.value)}
            placeholder="your-company.atlassian.net"
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Atlassian Cloud のドメイン（https:// は不要）
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Email
          </label>
          <input
            type="email"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            placeholder="your-email@example.com"
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Atlassian アカウントのメールアドレス
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            API Token
          </label>
          <input
            type="password"
            value={formApiToken}
            onChange={(e) => setFormApiToken(e.target.value)}
            placeholder={config.configured ? "新しいトークンを入力（更新する場合）" : "ATATT3x..."}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Atlassian API Token（パスワードではありません）
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "検証中..." : "保存"}
          </button>

          {config.configured && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? "削除中..." : "削除"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
