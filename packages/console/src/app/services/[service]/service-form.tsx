"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ServiceName } from "@/lib/vault";

interface Field {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  editable?: boolean; // 連携後も個別に編集可能
}

interface ServiceFormProps {
  service: ServiceName;
  fields: Field[];
  authType: "api_key" | "oauth";
  oauthCallbackUrl?: string;
}

// OAuthをサポートするサービス
const OAUTH_SERVICES: ServiceName[] = ["google_calendar", "tanita_health_planet"];

export function ServiceForm({ service, fields, authType, oauthCallbackUrl }: ServiceFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [maskedData, setMaskedData] = useState<Record<string, string> | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editableData, setEditableData] = useState<Record<string, string>>({});
  const [savingEditable, setSavingEditable] = useState<string | null>(null);

  // URLパラメータからエラー/成功メッセージを取得
  useEffect(() => {
    const errorParam = searchParams.get("error");
    const successParam = searchParams.get("success");
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    }
    if (successParam) {
      setSuccess(decodeURIComponent(successParam));
    }
  }, [searchParams]);

  useEffect(() => {
    async function fetchCredentials() {
      try {
        const res = await fetch(`/api/services/${service}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setConnected(data.connected);
        if (data.credentials) {
          setMaskedData(data.credentials);
          // editable フィールドの初期値を設定
          const editableFields = fields.filter(f => f.editable);
          const initialEditable: Record<string, string> = {};
          for (const field of editableFields) {
            if (data.credentials[field.key]) {
              initialEditable[field.key] = data.credentials[field.key];
            }
          }
          setEditableData(initialEditable);
        }
      } catch {
        setError("認証情報の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    }
    fetchCredentials();
  }, [service, fields]);

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

  // editableフィールドを保存
  const handleSaveEditable = async (fieldKey: string) => {
    setSavingEditable(fieldKey);
    setError(null);
    setSuccess(null);

    try {
      const value = editableData[fieldKey];
      const res = await fetch(`/api/services/${service}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: value ? { [fieldKey]: value } : undefined,
          deletes: value ? undefined : [fieldKey],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "更新に失敗しました");
      }

      setSuccess("保存しました");

      // 再取得
      const refreshRes = await fetch(`/api/services/${service}`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setMaskedData(refreshData.credentials);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setSavingEditable(null);
    }
  };

  // editableフィールドを削除
  const handleDeleteEditable = async (fieldKey: string) => {
    if (!confirm("この設定を削除しますか？")) {
      return;
    }

    setSavingEditable(fieldKey);
    setError(null);

    try {
      const res = await fetch(`/api/services/${service}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deletes: [fieldKey],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "削除に失敗しました");
      }

      setEditableData((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
      setSuccess("削除しました");

      // 再取得
      const refreshRes = await fetch(`/api/services/${service}`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setMaskedData(refreshData.credentials);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setSavingEditable(null);
    }
  };

  // OAuth認証を開始
  const handleOAuthStart = async () => {
    setOauthLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/oauth/${service}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "OAuth認証の開始に失敗しました");
      }

      // 認証URLにリダイレクト
      window.location.href = data.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth認証の開始に失敗しました");
      setOauthLoading(false);
    }
  };

  // OAuth認証済みかどうかを判定
  const hasOAuthToken = maskedData && maskedData.access_token;
  const hasClientCredentials = maskedData && maskedData.client_id && maskedData.client_secret;
  const supportsOAuth = OAUTH_SERVICES.includes(service);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-500 dark:text-zinc-400">読み込み中...</p>
      </div>
    );
  }

  // editable と non-editable フィールドを分離
  const editableFields = fields.filter(f => f.editable);
  const nonEditableFields = fields.filter(f => !f.editable);

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      {connected && maskedData && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-green-800 dark:text-green-200 font-medium mb-2">
            連携中
          </p>
          <div className="space-y-1">
            {Object.entries(maskedData)
              .filter(([key]) => !editableFields.some(f => f.key === key))
              .map(([key, value]) => (
                <p key={key} className="text-sm text-green-700 dark:text-green-300">
                  {key}: {value}
                </p>
              ))}
          </div>
        </div>
      )}

      {/* Editable フィールド（連携後に個別編集可能） */}
      {connected && editableFields.length > 0 && (
        <div className="mb-6 space-y-4">
          {editableFields.map((field) => (
            <div key={field.key} className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <label
                htmlFor={`editable-${field.key}`}
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
              >
                {field.label}
              </label>
              {field.multiline ? (
                <textarea
                  id={`editable-${field.key}`}
                  value={editableData[field.key] || ""}
                  onChange={(e) =>
                    setEditableData((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  rows={4}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              ) : (
                <input
                  id={`editable-${field.key}`}
                  type={field.type || "text"}
                  value={editableData[field.key] || ""}
                  onChange={(e) =>
                    setEditableData((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              {field.hint && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {field.hint}
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleSaveEditable(field.key)}
                  disabled={savingEditable === field.key}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingEditable === field.key ? "保存中..." : "保存"}
                </button>
                {editableData[field.key] && (
                  <button
                    type="button"
                    onClick={() => handleDeleteEditable(field.key)}
                    disabled={savingEditable === field.key}
                    className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    削除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 未連携時は全フィールド、連携時はnon-editableフィールドのみ */}
        {(connected ? nonEditableFields : fields).map((field) => (
          <div key={field.key}>
            <label
              htmlFor={field.key}
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {field.multiline ? (
              <textarea
                id={field.key}
                value={formData[field.key] || ""}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={connected ? "(変更する場合のみ入力)" : field.placeholder}
                rows={4}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            ) : (
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
            )}
            {field.hint && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {field.hint}
              </p>
            )}
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

      {/* OAuth認証セクション */}
      {supportsOAuth && (
        <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
            OAuth認証
          </h3>

          {/* コールバックURL表示 */}
          {oauthCallbackUrl && (
            <div className="mb-4 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                OAuthプロバイダに登録するコールバックURL:
              </p>
              <code className="text-sm text-zinc-800 dark:text-zinc-200 break-all select-all">
                {oauthCallbackUrl}
              </code>
            </div>
          )}

          {hasOAuthToken ? (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-700 dark:text-green-300">
                  OAuth認証済み
                </p>
              </div>
              <button
                type="button"
                onClick={handleOAuthStart}
                disabled={oauthLoading}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {oauthLoading ? "認証中..." : "再認証（スコープ変更時など）"}
              </button>
            </div>
          ) : hasClientCredentials ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Client ID と Client Secret が保存されています。OAuth認証を開始してください。
              </p>
              <button
                type="button"
                onClick={handleOAuthStart}
                disabled={oauthLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {oauthLoading ? "認証中..." : "OAuth認証を開始"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              OAuth認証を開始するには、まず Client ID と Client Secret を保存してください。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
