"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/components/api-client";

type ModelStatus = "installed" | "available" | "downloading" | "failed";

type ModelRecord = {
  id: string;
  name: string;
  provider: string;
  version?: string;
  size?: string;
  status: ModelStatus;
  path?: string | null;
  sourceUrl?: string;
  lastUsed?: string;
};

type ModelsResponse = {
  models?: ModelRecord[];
  error?: string;
};

type DownloadResponse = {
  ok?: boolean;
  exists?: boolean;
  path?: string;
  size?: string;
  message?: string;
  error?: string;
};

const filters: Array<{ value: "all" | ModelStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "installed", label: "Installed" },
  { value: "available", label: "Available" },
  { value: "downloading", label: "Downloading" },
  { value: "failed", label: "Failed" },
];

export default function ManageModelsPage() {
  const api = useApi();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [filter, setFilter] = useState<"all" | ModelStatus>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const updateModel = useCallback(
    (modelId: string, changes: Partial<ModelRecord>) => {
      setModels((current) =>
        current.map((model) =>
          model.id === modelId ? { ...model, ...changes } : model
        )
      );
    },
    []
  );

  const loadModels = useCallback(async () => {
    const res = await api<ModelsResponse>(
      "/api/models/refresh",
      { method: "GET", cache: "no-store" },
      "Unable to load models"
    );
    if (res.ok) {
      setModels(res.data?.models ?? []);
      setError("");
    } else if (res.status !== 401) {
      setError(res.error ?? "Unable to load models");
    }
    setLoading(false);
  }, [api]);

  const refreshModels = useCallback(async () => {
    setRefreshing(true);
    await loadModels();
    setRefreshing(false);
  }, [loadModels]);

  useEffect(() => {
    let cancelled = false;
    void api<ModelsResponse>(
      "/api/models/refresh",
      { method: "GET", cache: "no-store" },
      "Unable to load models"
    ).then((res) => {
      if (cancelled) return;
      if (res.ok) setModels(res.data?.models ?? []);
      else if (res.status !== 401) setError(res.error ?? "Unable to load models");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const downloadModel = useCallback(
    async (model: ModelRecord) => {
      if (
        model.status === "installed" ||
        model.status === "downloading" ||
        !model.sourceUrl
      ) {
        if (!model.sourceUrl && model.status !== "installed") {
          setError(`No Hugging Face URL is configured for ${model.name}.`);
        }
        return;
      }

      setNotice("");
      setError("");
      updateModel(model.id, {
        status: "downloading",
        lastUsed: "Downloading...",
      });

      const res = await api<DownloadResponse>(
        "/api/models/download",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: model.id,
            name: model.name,
            sourceUrl: model.sourceUrl,
          }),
        },
        "Model download failed"
      );
      const payload = res.data ?? {};

      if (res.status === 409) {
        // 409 carries the existing-model payload in the error body; re-read it.
        updateModel(model.id, { status: "installed", lastUsed: "Already installed" });
        setNotice(`${model.name} already exists.`);
        await refreshModels();
        return;
      }

      if (!res.ok) {
        if (res.status === 401) return;
        const message = res.error ?? "Model download failed";
        updateModel(model.id, { status: "failed", lastUsed: message });
        setError(message);
        return;
      }

      updateModel(model.id, {
        status: "installed",
        path: payload.path ?? null,
        size: payload.size ?? model.size,
        lastUsed: "Just now",
      });

      setNotice(`${model.name} downloaded successfully.`);
      await refreshModels();
    },
    [api, refreshModels, updateModel]
  );

  const visibleModels = useMemo(() => {
    if (filter === "all") return models;
    return models.filter((model) => model.status === filter);
  }, [filter, models]);

  return (
    <main className="models-page">
      <header className="models-hero">
        <div>
          <span className="models-eyebrow">AI Models</span>
          <h1>Manage Models</h1>
          <p>
            Download and manage Hugging Face models using your configured
            application directory.
          </p>
        </div>

        <div className="models-actions">
          <button
            type="button"
            className="models-button models-button-secondary"
            onClick={() => void refreshModels()}
            disabled={refreshing}
          >
            <span aria-hidden="true">↻</span>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          <Link
            className="models-button models-button-primary"
            href="/settings"
          >
            Settings
          </Link>
        </div>
      </header>

      <nav className="models-tabs" aria-label="Model filters">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? "active" : ""}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
            <span>
              {item.value === "all"
                ? models.length
                : models.filter((model) => model.status === item.value).length}
            </span>
          </button>
        ))}
      </nav>

      {error && <div className="models-alert models-alert-error" role="alert">{error}</div>}
      {notice && (
        <div className="models-alert models-alert-success" role="status">{notice}</div>
      )}

      {loading ? (
        <div className="models-state" role="status">Loading models...</div>
      ) : visibleModels.length === 0 ? (
        <div className="models-state">
          <div className="models-state-icon">◌</div>
          <h2>No models found</h2>
          <p>Configure a Hugging Face model in Settings to get started.</p>
        </div>
      ) : (
        <section className="models-grid" aria-label="Available models">
          {visibleModels.map((model) => (
            <article className="model-card" key={model.id}>
              <div className="model-card-top">
                <div className="model-icon">HF</div>
                <span className={`model-status ${model.status}`}>
                  <i />
                  {model.status}
                </span>
              </div>

              <div className="model-card-title">
                <span>{model.provider}</span>
                <h2>{model.name}</h2>
                <code>{model.id}</code>
              </div>

              <div className="model-meta">
                <div>
                  <span>Size</span>
                  <strong>{model.size || "Unknown"}</strong>
                </div>
                <div>
                  <span>Last used</span>
                  <strong>{model.lastUsed || "Never"}</strong>
                </div>
              </div>

              <div className="model-card-footer">
                {model.status === "installed" ? (
                  <span className="model-installed">✓ Installed</span>
                ) : (
                  <button
                    type="button"
                    className="models-button models-button-primary model-download"
                    onClick={() => void downloadModel(model)}
                    disabled={model.status === "downloading"}
                  >
                    {model.status === "downloading"
                      ? "Downloading..."
                      : model.status === "failed"
                        ? "Retry download"
                        : "Download model"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}