"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ServiceName } from "@/lib/vault";

interface Field {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}

interface ServiceFormProps {
  service: ServiceName;
  fields: Field[];
  authType: "api_key" | "oauth";
}

export function ServiceForm({ service, fields, authType }: ServiceFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [maskedData, setMaskedData] = useState<Record<string, string> | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCredentials() {
      try {
        const res = await fetch(`/api/services/${service}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setConnected(data.connected);
        if (data.credentials) {
          setMaskedData(data.credentials);
        }
      } catch {
        setError("認証情報の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    }
    fetchCredentials();
  }, [service]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    // 空のフィールドを除外
    const credentials: Record<string, string> = {};
    for (const field of fields) {
      if (formData[field.key]) {
        credentials[field.key] = formData[field.key];
      }
    }

    // 必須フィールドのチェック
    // required: true のフィールドは、新規・更新問わず必ず入力が必要
    const requiredFields = fields.filter((f) => f.required);
    for (const field of requiredFields) {
      if (!credentials[field.key]) {
        setError(`${field.label} は必須です`);
        setSaving(false);
        return;
      }
    }

    // 入力がない場合はエラー
    if (Object.keys(credentials).length === 0) {
      setError("少なくとも1つのフィールドを入力してください");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/services/${service}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存に失敗しました");
      }

      setSuccess("保存しました");
      setConnected(true);
      setFormData({});

      // 再取得
      const refreshRes = await fetch(`/api/services/${service}`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setMaskedData(refreshData.credentials);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("連携を解除しますか？認証情報は削除されます。")) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/services/${service}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("削除に失敗しました");
      }

      setConnected(false);
      setMaskedData(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-500 dark:text-zinc-400">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      {connected && maskedData && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-green-800 dark:text-green-200 font-medium mb-2">
            連携中
          </p>
          <div className="space-y-1">
            {Object.entries(maskedData).map(([key, value]) => (
              <p key={key} className="text-sm text-green-700 dark:text-green-300">
                {key}: {value}
              </p>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={field.key}
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              id={field.key}
              type={field.type || "text"}
              value={formData[field.key] || ""}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              placeholder={connected ? "(変更する場合のみ入力)" : field.placeholder}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {success && (
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "保存中..." : "保存"}
          </button>

          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={deleting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? "解除中..." : "連携解除"}
            </button>
          )}
        </div>
      </form>

      {authType === "oauth" && !connected && (
        <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            OAuth認証を開始するには、まず Client ID と Client Secret を保存してください。
          </p>
        </div>
      )}
    </div>
  );
}
