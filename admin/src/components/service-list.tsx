"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ServiceStatus {
  service: string;
  displayName: string;
  authType: "api_key" | "oauth";
  connected: boolean;
  expiresAt: string | null;
}

export function ServiceList() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {services.map((service) => (
        <Link
          key={service.service}
          href={`/services/${service.service}`}
          className="p-4 bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
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
      ))}
    </div>
  );
}
