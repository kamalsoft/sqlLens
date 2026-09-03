"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ModelStatus = "installed" | "downloading" | "available" | "failed";

type ModelRecord = {
  id: string;
  name: string;
  provider: string;
  version: string;
  size: string;
  status: ModelStatus;
  path?: string | null;
  lastUsed?: string;
};

const initialModels: ModelRecord[] = [
  {
    id: "gpt-4o-mini",
    name: "gpt-4o-mini",
    provider: "OpenAI",
    version: "2024-07-18",
    size: "245 MB",
    status: "installed",
    path: "~/models/gpt-4o-mini",
    lastUsed: "2 mins ago",
  },
  {
    id: "phi-3-mini",
    name: "phi-3-mini",
    provider: "Ollama",
    version: "3.8b",
    size: "2.3 GB",
    status: "available",
    path: null,
    lastUsed: "Never",
  },
  {
    id: "mistral-7b",
    name: "mistral-7b",
    provider: "Hugging Face",
    version: "7B",
    size: "14 GB",
    status: "downloading",
    path: null,
    lastUsed: "Downloading...",
  },
];

export default function ManageModelsPage() {
  const [models, setModels] = useState<ModelRecord[]>(initialModels);
  const [filter, setFilter] = useState("all");

  const setModelById = (id: string, patch: Partial<ModelRecord>) => {
    setModels((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      )
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem("sqlens-models");
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as ModelRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setModels(parsed);
      }
    } catch {
      // ignore invalid local storage
    }
  }, []);

  const visibleModels =
    filter === "all"
      ? models
      : models.filter((m) => m.status === filter);

  const handleDownload = async (model: ModelRecord) => {
    setModelById(model.id, {
      status: "downloading" as ModelStatus,
      lastUsed: "Downloading...",
    });

    try {
      const response = await fetch("/api/models/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: model.id,
          name: model.name,
          provider: model.provider,
          sourceUrl: "",
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Download failed");
      }

      setModels((current) => {
        const next: ModelRecord[] = current.map((entry) =>
          entry.id === model.id
            ? {
                ...entry,
                status: "installed" as ModelStatus,
                path: payload.path || entry.path || null,
                size: payload.size || entry.size,
                lastUsed: "Just now",
              }
            : entry
        );

        if (typeof window !== "undefined") {
          window.localStorage.setItem("sqlens-models", JSON.stringify(next));
        }

        return next;
      });
    } catch {
      setModels((current) =>
        current.map((entry) =>
          entry.id === model.id
            ? {
                ...entry,
                status: "failed" as ModelStatus,
                lastUsed: "Failed",
              }
            : entry
        )
      );
    }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
            AI Models
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-white">
            Manage Models
          </h1>
        </div>

        <div className="flex gap-3">
          <Link
            href="/settings"
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Settings
          </Link>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        {["all", "installed", "available", "downloading", "failed"].map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1.5 text-sm capitalize transition ${
              filter === value
                ? "bg-blue-600 text-white"
                : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleModels.map((model) => (
          <article
            key={model.id}
            className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-lg shadow-slate-950/30"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{model.name}</h2>
                <p className="text-sm text-slate-400">
                  {model.provider} · {model.version}
                </p>
              </div>

              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  model.status === "installed"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : model.status === "downloading"
                      ? "bg-amber-500/15 text-amber-300"
                      : model.status === "failed"
                        ? "bg-red-500/15 text-red-300"
                        : "bg-slate-700 text-slate-200"
                }`}
              >
                {model.status}
              </span>
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-4 text-sm text-slate-300">
              <div className="flex justify-between">
                <span>Size</span>
                <span>{model.size}</span>
              </div>
              <div className="flex justify-between">
                <span>Last Used</span>
                <span>{model.lastUsed || "Never"}</span>
              </div>
              {model.path ? (
                <div className="flex justify-between">
                  <span>Path</span>
                  <span className="max-w-[180px] truncate text-right">{model.path}</span>
                </div>
              ) : null}
            </div>

            <div className="mt-5">
              {model.status === "installed" ? (
                <button
                  disabled
                  className="w-full rounded-lg bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-200"
                >
                  Installed
                </button>
              ) : (
                <button
                  onClick={() => handleDownload(model)}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  {model.status === "downloading" ? "Downloading..." : "Download"}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}