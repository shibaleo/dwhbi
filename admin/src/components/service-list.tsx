"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface ServiceStatus {
  service: string;
  displayName: string;
  authType: "api_key" | "oauth";
  connected: boolean;
  expiresAt: string | null;
}

interface WorkflowRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  html_url: string;
}

interface Props {
  githubConfigured: boolean;
}

// ワークフロー名とサービス名のマッピング
const WORKFLOW_TO_SERVICE: Record<string, string> = {
  "Toggl Daily Sync": "toggl_track",
  "Toggl Report Sync": "toggl_track",
  "Fitbit Daily Sync": "fitbit",
  "Zaim Daily Sync": "zaim",
  "Google Calendar Sync": "google_calendar",
  "Tanita Daily Sync": "tanita",
  "Trello Daily Sync": "trello",
  "TickTick Daily Sync": "ticktick",
  "Airtable Daily Sync": "airtable",
};

function formatDuration(startedAt: string | null, updatedAt: string): string {
  if (!startedAt) return "";
  const start = new Date(startedAt);
  const end = new Date(updatedAt);
  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

export function ServiceList({ githubConfigured }: Props) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ service: string; success: boolean; message: string } | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);

  const fetchWorkflows = useCallback(async () => {
    if (!githubConfigured) return;
    try {
      const res = await fetch("/api/workflows");
      if (res.ok) {
        const data = await res.json();
        setWorkflowRuns(data.runs || []);
      }
    } catch {
      // ignore
    }
  }, [githubConfigured]);

  useEffect(() => {
    async function fetchServices() {
      try {
        const res = await fetch("/api/services");
        if (!res.ok) {
          throw new Error("Failed to fetch services");
        }
        const data = await res.json();
        setServices(data.services);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }
    fetchServices();
    fetchWorkflows();
  }, [fetchWorkflows]);

  // 実行中のワークフローがある場合のみポーリング（30秒間隔）
  // ページが非アクティブの場合はポーリングしない
  useEffect(() => {
    const hasRunningWorkflow = workflowRuns.some(
      (run) => run.status === "in_progress" || run.status === "queued"
    );

    if (!hasRunningWorkflow) return;

    let intervalId: NodeJS.Timeout | null = null;

    function startPolling() {
      if (intervalId) return;
      intervalId = setInterval(fetchWorkflows, 30000); // 30秒間隔
    }

    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchWorkflows(); // すぐに更新
        startPolling();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (!document.hidden) {
      startPolling();
    }

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [workflowRuns, fetchWorkflows]);

  async function handleSync(service: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setSyncing(service);
    setSyncResult(null);

    try {
      const res = await fetch(`/api/dispatch/${service}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      if (!res.ok) {
        setSyncResult({
          service,
          success: false,
          message: data.error || "同期の開始に失敗しました",
        });
      } else {
        setSyncResult({
          service,
          success: true,
          message: `${service} の同期を開始しました`,
        });
        // ワークフロー一覧を更新
        setTimeout(fetchWorkflows, 2000);
      }
    } catch {
      setSyncResult({
        service,
        success: false,
        message: "同期の開始に失敗しました",
      });
    } finally {
      setSyncing(null);
    }
  }

  // サービスごとの最新ワークフロー実行を取得
  function getLatestRun(serviceName: string): WorkflowRun | undefined {
    return workflowRuns.find((run) => {
      const mappedService = WORKFLOW_TO_SERVICE[run.name];
      return mappedService === serviceName;
    });
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="p-4 bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 animate-pulse"
          >
            <div className="h-5 bg-zinc-200 dark:bg-zinc-800 rounded w-20 mb-2" />
            <div className="h-4 bg-zinc-100 dark:bg-zinc-900 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <>
      {syncResult && (
        <div
          className={`mb-4 p-3 rounded-lg border ${
            syncResult.success
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          }`}
        >
          <p
            className={`text-sm ${
              syncResult.success
                ? "text-green-800 dark:text-green-200"
                : "text-red-800 dark:text-red-200"
            }`}
          >
            {syncResult.success ? "✓ " : "✗ "}{syncResult.message}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {services.map((service) => {
          const latestRun = getLatestRun(service.service);
          const isRunning = latestRun && (latestRun.status === "in_progress" || latestRun.status === "queued");

          return (
            <div
              key={service.service}
              className="p-4 bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <Link
                href={`/services/${service.service}`}
                className="block hover:opacity-80 transition-opacity"
              >
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  {service.displayName}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  {service.connected ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-sm text-green-600 dark:text-green-400">
                        連携中
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        未設定
                      </span>
                    </>
                  )}
                </div>
                {service.connected && service.expiresAt && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                    期限: {new Date(service.expiresAt).toLocaleDateString("ja-JP")}
                  </p>
                )}
              </Link>

              {/* 最新の実行状態 */}
              {latestRun && (
                <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <a
                    href={latestRun.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs hover:underline"
                  >
                    {isRunning ? (
                      <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        実行中 {formatDuration(latestRun.run_started_at, new Date().toISOString())}
                      </span>
                    ) : latestRun.conclusion === "success" ? (
                      <span className="text-green-600 dark:text-green-400">
                        ✓ 成功 ({formatTimeAgo(latestRun.updated_at)})
                      </span>
                    ) : latestRun.conclusion === "failure" ? (
                      <span className="text-red-600 dark:text-red-400">
                        ✗ 失敗 ({formatTimeAgo(latestRun.updated_at)})
                      </span>
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {latestRun.status} ({formatTimeAgo(latestRun.updated_at)})
                      </span>
                    )}
                  </a>
                </div>
              )}

              {/* 同期実行ボタン - GitHub PAT設定済み かつ サービス連携中 の場合のみ表示 */}
              {githubConfigured && service.connected && (
                <button
                  onClick={(e) => handleSync(service.service, e)}
                  disabled={syncing === service.service || isRunning}
                  className="mt-3 w-full px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {syncing === service.service
                    ? "開始中..."
                    : isRunning
                    ? "実行中..."
                    : "同期実行"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
