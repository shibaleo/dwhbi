"use client";

import { useState, useEffect } from "react";

interface WorkflowUsage {
  name: string;
  totalMs: number;
  runCount: number;
}

interface ActionsUsage {
  totalMinutesUsed: number;
  includedMinutes: number;
  percentUsed: number;
  workflows: WorkflowUsage[];
  billingPeriod: {
    start: string;
    end: string;
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}秒`;
  }
  return `${minutes}分${seconds}秒`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}時間${mins}分`;
}

export function UsageDisplay() {
  const [usage, setUsage] = useState<ActionsUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsage();
  }, []);

  async function fetchUsage() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/github/usage");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "使用量の取得に失敗しました");
        return;
      }

      setUsage(data);
    } catch {
      setError("使用量の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-8">
        <p className="text-zinc-500 dark:text-zinc-400 text-center">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-8">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          {error.includes("actions:read") && (
            <div className="text-left bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 mt-4">
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">
                PATに以下の権限を追加してください：
              </p>
              <ul className="text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside">
                <li>Repository permissions → Actions → Read-only</li>
              </ul>
              <a
                href="/settings/github"
                className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                GitHub設定を更新 →
              </a>
            </div>
          )}
          <button
            onClick={fetchUsage}
            className="mt-4 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg text-sm"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (!usage) {
    return null;
  }

  const progressColor =
    usage.percentUsed < 50 ? "bg-green-500" :
    usage.percentUsed < 80 ? "bg-yellow-500" :
    "bg-red-500";

  return (
    <div className="space-y-6">
      {/* サマリーカード */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            今月の使用量
          </h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {usage.billingPeriod.start} 〜 {usage.billingPeriod.end}
          </span>
        </div>

        <div className="mb-4">
          <div className="flex items-end gap-2 mb-2">
            <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatMinutes(usage.totalMinutesUsed)}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400 mb-1">
              / {formatMinutes(usage.includedMinutes)}
            </span>
          </div>
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${progressColor}`}
              style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
            />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            無料枠の {usage.percentUsed}% を使用中
          </p>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          ※ GitHub Free プランは月2,000分の無料枠があります
        </p>
      </div>

      {/* ワークフロー別使用量 */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
          ワークフロー別使用量
        </h2>

        {usage.workflows.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            今月のワークフロー実行はありません
          </p>
        ) : (
          <div className="space-y-3">
            {usage.workflows.map((workflow) => (
              <div
                key={workflow.name}
                className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
              >
                <div>
                  <p className="text-zinc-900 dark:text-zinc-100 font-medium">
                    {workflow.name}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {workflow.runCount}回実行
                  </p>
                </div>
                <span className="text-zinc-700 dark:text-zinc-300 font-mono text-sm">
                  {formatDuration(workflow.totalMs)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 更新ボタン */}
      <div className="flex justify-center">
        <button
          onClick={fetchUsage}
          className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          データを更新
        </button>
      </div>
    </div>
  );
}
