"use client";

import { useState, useEffect } from "react";

interface GitHubConfigState {
  configured: boolean;
  pat: string;
  owner: string;
  repo: string;
  expiresAt: string | null;
}

function formatExpiresAt(dateStr: string | null): string {
  if (!dateStr) return "未設定";
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const formatted = date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  if (diffDays < 0) {
    return `${formatted}（期限切れ）`;
  } else if (diffDays <= 7) {
    return `${formatted}（残り${diffDays}日）`;
  } else if (diffDays <= 30) {
    return `${formatted}（残り${diffDays}日）`;
  }
  return formatted;
}

function getExpiresAtStyle(dateStr: string | null): string {
  if (!dateStr) return "text-zinc-500 dark:text-zinc-400";
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return "text-red-600 dark:text-red-400";
  } else if (diffDays <= 7) {
    return "text-red-600 dark:text-red-400";
  } else if (diffDays <= 30) {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-green-600 dark:text-green-400";
}

export function GitHubForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [config, setConfig] = useState<GitHubConfigState>({
    configured: false,
    pat: "",
    owner: "",
    repo: "",
    expiresAt: null,
  });

  const [form, setForm] = useState({
    pat: "",
    owner: "",
    repo: "",
    expiresAt: "",
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch("/api/github");
      if (!res.ok) throw new Error("Failed to fetch config");
      const data = await res.json();
      setConfig(data);
      if (data.configured) {
        setForm({
          pat: "",
          owner: data.owner,
          repo: data.repo,
          expiresAt: data.expiresAt ? data.expiresAt.split("T")[0] : "",
        });
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

    try {
      // PATが空で既存設定がある場合、既存のPATを使用するためエラー
      if (!form.pat && !config.configured) {
        setError("PAT を入力してください");
        setSaving(false);
        return;
      }

      // PATが空の場合は更新しない旨をAPIに伝える必要があるが、
      // 今回はシンプルに全フィールド必須とする
      if (!form.pat) {
        setError("PAT を入力してください（更新時も必須）");
        setSaving(false);
        return;
      }

      const payload = {
        pat: form.pat,
        owner: form.owner,
        repo: form.repo,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };

      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setSuccess("設定を保存しました");
      await fetchConfig();
      setForm(f => ({ ...f, pat: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("GitHub 設定を削除しますか？")) return;

    setError(null);
    setSuccess(null);
    setDeleting(true);

    try {
      const res = await fetch("/api/github", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");

      setSuccess("設定を削除しました");
      setConfig({ configured: false, pat: "", owner: "", repo: "", expiresAt: null });
      setForm({ pat: "", owner: "", repo: "", expiresAt: "" });
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
            設定済み: {config.owner}/{config.repo}
          </p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            PAT: {config.pat}
          </p>
          <p className={`text-xs mt-1 ${getExpiresAtStyle(config.expiresAt)}`}>
            有効期限: {formatExpiresAt(config.expiresAt)}
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
            Repository Owner
          </label>
          <input
            type="text"
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
            placeholder="username or organization"
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Repository Name
          </label>
          <input
            type="text"
            value={form.repo}
            onChange={(e) => setForm({ ...form, repo: e.target.value })}
            placeholder="supabase-sync-jobs"
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Personal Access Token
          </label>
          <input
            type="password"
            value={form.pat}
            onChange={(e) => setForm({ ...form, pat: e.target.value })}
            placeholder={config.configured ? "新しいトークンを入力（更新する場合）" : "github_pat_..."}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Fine-grained PAT を使用してください（Actions: Read and write 権限が必要）
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            有効期限（YYYY-MM-DD）
          </label>
          <input
            type="text"
            value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            placeholder="2025-03-03"
            pattern="\d{4}-\d{2}-\d{2}"
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            PAT作成時に設定した有効期限を入力してください（期限切れ通知用）
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "検証中..." : "保存"}
          </button>

          {config.configured && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? "削除中..." : "削除"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
