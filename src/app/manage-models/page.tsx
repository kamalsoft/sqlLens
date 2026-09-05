"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

  const refreshModels = useCallback(async () => {
    setRefreshing(true);

    try {
      const response = await fetch("/api/models/refresh", {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as ModelsResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load models");
      }

      setModels(payload.models ?? []);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load models"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

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

      try {
        const response = await fetch("/api/models/download", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            modelId: model.id,
            name: model.name,
            sourceUrl: model.sourceUrl,
          }),
        });

        const payload = (await response.json()) as DownloadResponse;

        if (response.status === 409 && payload.exists) {
          updateModel(model.id, {
            status: "installed",
            path: payload.path ?? null,
            lastUsed: "Already installed",
          });
          setNotice(payload.message || `${model.name} already exists.`);
          await refreshModels();
          return;
        }

        if (!response.ok) {
          throw new Error(payload.error || "Model download failed");
        }

        updateModel(model.id, {
          status: "installed",
          path: payload.path ?? null,
          size: payload.size ?? model.size,
          lastUsed: "Just now",
        });

        setNotice(`${model.name} downloaded successfully.`);
        await refreshModels();
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Model download failed";

        updateModel(model.id, {
          status: "failed",
          lastUsed: message,
        });
        setError(message);
      }
    },
    [refreshModels, updateModel]
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

      {error && <div className="models-alert models-alert-error">{error}</div>}
      {notice && (
        <div className="models-alert models-alert-success">{notice}</div>
      )}

      {loading ? (
        <div className="models-state">Loading models...</div>
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