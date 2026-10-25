"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/components/api-client";

type Engine = "simulation" | "mssql" | "postgres";

type AppSettings = {
  provider: "local";
  defaultModel: string;
  downloadDirectory: string;
  autoDownload: boolean;
  autoUpdateModels: boolean;
  maxConcurrentDownloads: number;
  temperature: number;
  contextWindow: number;
  allowTelemetry: boolean;
  prompt?: Record<string, string>;
  allowLiveExecution: boolean;
  queryTimeoutMs: number;
  defaultEngine: Engine;
  maxSqlLength: number;
  inferenceTimeoutMs: number;
  logSqlText: boolean;
  shareTtlHours: number;
};

// Mirrors C6 defaults in docs/team/contracts.md.
const defaultSettings: AppSettings = {
  provider: "local",
  defaultModel: "onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
  downloadDirectory: "downloads/models",
  autoDownload: false,
  autoUpdateModels: false,
  maxConcurrentDownloads: 2,
  temperature: 0.2,
  contextWindow: 4096,
  allowTelemetry: false,
  allowLiveExecution: false,
  queryTimeoutMs: 30000,
  defaultEngine: "simulation",
  maxSqlLength: 100000,
  inferenceTimeoutMs: 120000,
  logSqlText: true,
  shareTtlHours: 24,
};

const knownKeys = Object.keys(defaultSettings).concat("prompt") as Array<keyof AppSettings>;

/** Keep only known C6 fields so nothing unexpected (e.g. a legacy apiKey) is held or re-sent. */
function normalize(payload: Partial<AppSettings> | null): AppSettings {
  const next: Record<string, unknown> = { ...defaultSettings };
  if (payload) {
    for (const key of knownKeys) {
      if (payload[key] !== undefined) next[key] = payload[key];
    }
  }
  return next as AppSettings;
}

function Field({
  label,
  name,
  error,
  full,
  children,
}: {
  label: string;
  name: string;
  error: { field: string | null; message: string } | null;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label className="label" htmlFor={`setting-${name}`}>
        {label}
      </label>
      {children}
      {error?.field === name && (
        <small role="alert" id={`setting-${name}-error`}>
          {error.message}
        </small>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const api = useApi();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<Partial<AppSettings>>("/api/appconfig", { cache: "no-store" }, "Unable to load settings").then(
      (result) => {
        if (cancelled) return;
        if (result.ok) setSettings(normalize(result.data));
        else if (result.status !== 401) {
          setError({ field: null, message: result.error ?? "Unable to load settings" });
        }
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError(null);
  };

  const num = (key: keyof AppSettings) => (event: React.ChangeEvent<HTMLInputElement>) =>
    update(key, Number(event.target.value) as never);

  async function handleSave() {
    setSaving(true);
    setMessage("");
    setError(null);

    const result = await api<Partial<AppSettings>>(
      "/api/appconfig",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      },
      "Unable to save settings"
    );

    if (result.ok) {
      setSettings(normalize(result.data));
      setMessage("Settings saved.");
    } else if (result.status !== 401) {
      setError({ field: result.field, message: result.error ?? "Unable to save settings" });
    }
    setSaving(false);
  }

  const disabled = loading || saving;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Configuration</p>
          <h2 className="page-title">Settings</h2>
        </div>

        <div className="page-actions">
          <a href="/manage-models" className="button button-secondary">
            Manage Models
          </a>
        </div>
      </header>

      {loading && <p role="status">Loading settings...</p>}

      <section className="panel panel-card">
        <div className="form-grid">
          <Field label="Model Provider" name="provider" error={error}>
            <input id="setting-provider" value={settings.provider} readOnly />
          </Field>

          <Field label="Default Model" name="defaultModel" error={error}>
            <input
              id="setting-defaultModel"
              value={settings.defaultModel}
              onChange={(event) => update("defaultModel", event.target.value)}
              disabled={disabled}
            />
          </Field>

          <Field label="Download Directory" name="downloadDirectory" error={error} full>
            <input
              id="setting-downloadDirectory"
              value={settings.downloadDirectory}
              onChange={(event) => update("downloadDirectory", event.target.value)}
              disabled={disabled}
            />
          </Field>

          <Field label="Temperature" name="temperature" error={error}>
            <input
              id="setting-temperature"
              type="number"
              step={0.1}
              value={settings.temperature}
              onChange={num("temperature")}
              disabled={disabled}
            />
          </Field>

          <Field label="Context Window" name="contextWindow" error={error}>
            <input
              id="setting-contextWindow"
              type="number"
              value={settings.contextWindow}
              onChange={num("contextWindow")}
              disabled={disabled}
            />
          </Field>

          <Field label="Max Concurrent Downloads" name="maxConcurrentDownloads" error={error}>
            <input
              id="setting-maxConcurrentDownloads"
              type="number"
              value={settings.maxConcurrentDownloads}
              onChange={num("maxConcurrentDownloads")}
              disabled={disabled}
            />
          </Field>

          <Field label="Inference Timeout (ms)" name="inferenceTimeoutMs" error={error}>
            <input
              id="setting-inferenceTimeoutMs"
              type="number"
              value={settings.inferenceTimeoutMs}
              onChange={num("inferenceTimeoutMs")}
              disabled={disabled}
            />
          </Field>

          <Field label="Max SQL Length (characters)" name="maxSqlLength" error={error}>
            <input
              id="setting-maxSqlLength"
              type="number"
              value={settings.maxSqlLength}
              onChange={num("maxSqlLength")}
              disabled={disabled}
            />
          </Field>

          <Field label="Query Timeout (ms)" name="queryTimeoutMs" error={error}>
            <input
              id="setting-queryTimeoutMs"
              type="number"
              value={settings.queryTimeoutMs}
              onChange={num("queryTimeoutMs")}
              disabled={disabled}
            />
          </Field>

          <Field label="Default Engine" name="defaultEngine" error={error}>
            <select
              id="setting-defaultEngine"
              value={settings.defaultEngine}
              onChange={(event) => update("defaultEngine", event.target.value as Engine)}
              disabled={disabled}
            >
              <option value="simulation">Simulation</option>
              <option value="mssql">SQL Server</option>
              <option value="postgres">PostgreSQL</option>
            </select>
          </Field>

          <Field label="Share Link Lifetime (hours)" name="shareTtlHours" error={error}>
            <input
              id="setting-shareTtlHours"
              type="number"
              value={settings.shareTtlHours}
              onChange={num("shareTtlHours")}
              disabled={disabled}
            />
          </Field>

          <Field label="Download Behavior" name="autoDownload" error={error}>
            <div className="checkbox-row">
              <span>Auto-download recommended models</span>
              <input
                id="setting-autoDownload"
                className="checkbox"
                type="checkbox"
                checked={settings.autoDownload}
                onChange={(event) => update("autoDownload", event.target.checked)}
                disabled={disabled}
              />
            </div>
          </Field>

          <Field label="Model Updates" name="autoUpdateModels" error={error}>
            <div className="checkbox-row">
              <span>Auto-update installed models</span>
              <input
                id="setting-autoUpdateModels"
                className="checkbox"
                type="checkbox"
                checked={settings.autoUpdateModels}
                onChange={(event) => update("autoUpdateModels", event.target.checked)}
                disabled={disabled}
              />
            </div>
          </Field>

          <Field label="Privacy" name="allowTelemetry" error={error}>
            <div className="checkbox-row">
              <span>Allow telemetry</span>
              <input
                id="setting-allowTelemetry"
                className="checkbox"
                type="checkbox"
                checked={settings.allowTelemetry}
                onChange={(event) => update("allowTelemetry", event.target.checked)}
                disabled={disabled}
              />
            </div>
          </Field>

          <Field label="SQL Logging" name="logSqlText" error={error}>
            <div className="checkbox-row">
              <span>Write SQL text to audit logs (off stores a hash and length only)</span>
              <input
                id="setting-logSqlText"
                className="checkbox"
                type="checkbox"
                checked={settings.logSqlText}
                onChange={(event) => update("logSqlText", event.target.checked)}
                disabled={disabled}
              />
            </div>
          </Field>

          <Field label="Live Execution" name="allowLiveExecution" error={error} full>
            <div className="checkbox-row">
              <span>Allow live execution against a real database</span>
              <input
                id="setting-allowLiveExecution"
                className="checkbox"
                type="checkbox"
                checked={settings.allowLiveExecution}
                onChange={(event) => update("allowLiveExecution", event.target.checked)}
                disabled={disabled}
              />
            </div>
            <small>
              Warning: when enabled, stored procedures run against the connected database and can
              change data. Leave off to use simulation only.
            </small>
          </Field>
        </div>
      </section>

      <button type="button" onClick={() => void handleSave()} disabled={disabled}>
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {message && <p role="status">{message}</p>}
      {error && error.field === null && <p role="alert">{error.message}</p>}
    </>
  );
}
