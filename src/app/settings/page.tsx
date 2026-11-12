"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/components/api-client";
import { SETTINGS_SAVED_EVENT } from "@/components/AppShell";

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
  maxNewTokens: number;
  logSqlText: boolean;
  shareTtlHours: number;
  retentionDays: number;
  maxLogicalReads: number | null;
  maxElapsedMs: number | null;
  maxScanCount: number | null;
  measuredRuns: number;
  showCompare: boolean;
  showRefactor: boolean;
  refactorModel: string;
  reviewModel: string;
  reviewSchema: "auto" | "v1" | "v2";
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
  maxNewTokens: 1536,
  logSqlText: false,
  shareTtlHours: 24,
  retentionDays: 90,
  maxLogicalReads: null,
  maxElapsedMs: null,
  maxScanCount: null,
  measuredRuns: 2,
  showCompare: false,
  showRefactor: false,
  refactorModel: "",
  reviewModel: "",
  reviewSchema: "auto",
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

/** A titled group of settings: one per category. */
function Group({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="panel panel-card settings-group" aria-labelledby={`settings-${id}`}>
      <h3 className="section-title" id={`settings-${id}`}>{title}</h3>
      <p className="analysis-note settings-group-note">{description}</p>
      <div className="form-grid">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const api = useApi();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  // Installed models that can run here, for the Refactor model list.
  const [models, setModels] = useState<{ id: string; name: string; parameterEstimate: number | null }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api<{ models?: { id: string; name: string; compatible: boolean; parameterEstimate: number | null }[] }>(
      "/api/review/models", { cache: "no-store" }, "Unable to load installed models",
    ).then((result) => {
      if (!cancelled && result.ok) setModels((result.data?.models ?? []).filter((m) => m.compatible));
    });
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
  // An empty target means "not set" (null), not zero.
  const optionalNum = (key: "maxLogicalReads" | "maxElapsedMs" | "maxScanCount") => (event: React.ChangeEvent<HTMLInputElement>) =>
    update(key, event.target.value.trim() === "" ? null : Number(event.target.value));

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
      window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
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

      {loading && <p role="status" className="status-note">Loading settings...</p>}

      <Group id="features" title="Features" description="Screens shown in the menu. A screen that is off cannot be opened.">
          <Field label="Show Compare" name="showCompare" error={error}>
            <div className="checkbox-row">
              <span>Show the Compare screen</span>
              <input id="setting-showCompare" className="checkbox" type="checkbox" checked={settings.showCompare}
                onChange={(event) => update("showCompare", event.target.checked)} disabled={disabled} />
            </div>
          </Field>
          <Field label="Show Refactor" name="showRefactor" error={error}>
            <div className="checkbox-row">
              <span>Show the Refactor screen</span>
              <input id="setting-showRefactor" className="checkbox" type="checkbox" checked={settings.showRefactor}
                onChange={(event) => update("showRefactor", event.target.checked)} disabled={disabled} />
            </div>
            <small className="field-hint">The refactor popup on Execute &amp; Audit is always available.</small>
          </Field>
      </Group>

      <Group id="models" title="Models and inference" description="The local model used for reviews, comparisons and refactors, and how it runs.">
          <Field label="Model Provider" name="provider" error={error}>
            <input id="setting-provider" className="input" value={settings.provider} readOnly />
          </Field>
          <Field label="Default Model" name="defaultModel" error={error}>
            <input id="setting-defaultModel" className="input" value={settings.defaultModel} onChange={(event) => update("defaultModel", event.target.value)} disabled={disabled} />
          </Field>
          <Field label="Refactor Model" name="refactorModel" error={error}>
            <select id="setting-refactorModel" className="select" value={settings.refactorModel}
              onChange={(event) => update("refactorModel", event.target.value)} disabled={disabled}>
              <option value="">Automatic: the best instruction-tuned model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.parameterEstimate ? ` (about ${(m.parameterEstimate / 1e9).toFixed(1)}B parameters)` : ""}
                </option>
              ))}
              {settings.refactorModel && !models.some((m) => m.id === settings.refactorModel) && (
                <option value={settings.refactorModel}>{settings.refactorModel} (not installed)</option>
              )}
            </select>
            <small className="field-hint">Used by Refactor on the Execute &amp; Audit SP screen. Pick an instruction-tuned model (Instruct or Chat): a base model does not follow the refactor instructions and can repeat itself.</small>
          </Field>
          <Field label="Review Model" name="reviewModel" error={error}>
            <select id="setting-reviewModel" className="select" value={settings.reviewModel}
              onChange={(event) => update("reviewModel", event.target.value)} disabled={disabled}>
              <option value="">Automatic: the best instruction-tuned model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.parameterEstimate ? ` (about ${(m.parameterEstimate / 1e9).toFixed(1)}B parameters)` : ""}
                </option>
              ))}
              {settings.reviewModel && !models.some((m) => m.id === settings.reviewModel) && (
                <option value={settings.reviewModel}>{settings.reviewModel} (not installed)</option>
              )}
            </select>
            <small className="field-hint">Used by Review Stored Procedure. A larger instruction-tuned model gives more reliable findings.</small>
          </Field>
          <Field label="Review Result Format" name="reviewSchema" error={error}>
            <select id="setting-reviewSchema" className="select" value={settings.reviewSchema}
              onChange={(event) => update("reviewSchema", event.target.value as AppSettings["reviewSchema"])} disabled={disabled}>
              <option value="auto">Auto: short format for small models, tables otherwise</option>
              <option value="v2">Tables: findings, performance, security, testing</option>
              <option value="v1">Short: summary and issues</option>
            </select>
            <small className="field-hint">A review that uses a run&apos;s telemetry always asks for the tables.</small>
          </Field>
          <Field label="Temperature" name="temperature" error={error}>
            <input id="setting-temperature" className="input" type="number" step={0.1} value={settings.temperature} onChange={num("temperature")} disabled={disabled} />
          </Field>
          <Field label="Context Window" name="contextWindow" error={error}>
            <input id="setting-contextWindow" className="input" type="number" value={settings.contextWindow} onChange={num("contextWindow")} disabled={disabled} />
          </Field>
          <Field label="Max New Tokens (model output)" name="maxNewTokens" error={error}>
            <input id="setting-maxNewTokens" className="input" type="number" value={settings.maxNewTokens} onChange={num("maxNewTokens")} disabled={disabled} />
          </Field>
          <Field label="Inference Timeout (ms)" name="inferenceTimeoutMs" error={error}>
            <input id="setting-inferenceTimeoutMs" className="input" type="number" value={settings.inferenceTimeoutMs} onChange={num("inferenceTimeoutMs")} disabled={disabled} />
          </Field>
      </Group>

      <Group id="downloads" title="Model downloads" description="Where models are stored and how they are fetched and kept up to date.">
          <Field label="Download Directory" name="downloadDirectory" error={error} full>
            <input id="setting-downloadDirectory" className="input" value={settings.downloadDirectory} onChange={(event) => update("downloadDirectory", event.target.value)} disabled={disabled} />
          </Field>
          <Field label="Max Concurrent Downloads" name="maxConcurrentDownloads" error={error}>
            <input id="setting-maxConcurrentDownloads" className="input" type="number" value={settings.maxConcurrentDownloads} onChange={num("maxConcurrentDownloads")} disabled={disabled} />
          </Field>
          <Field label="Download Behavior" name="autoDownload" error={error}>
            <div className="checkbox-row">
              <span>Auto-download recommended models</span>
              <input id="setting-autoDownload" className="checkbox" type="checkbox" checked={settings.autoDownload}
                onChange={(event) => update("autoDownload", event.target.checked)} disabled={disabled} />
            </div>
          </Field>
          <Field label="Model Updates" name="autoUpdateModels" error={error}>
            <div className="checkbox-row">
              <span>Auto-update installed models</span>
              <input id="setting-autoUpdateModels" className="checkbox" type="checkbox" checked={settings.autoUpdateModels}
                onChange={(event) => update("autoUpdateModels", event.target.checked)} disabled={disabled} />
            </div>
          </Field>
      </Group>

      <Group id="execution" title="SQL execution" description="How stored procedures and SQL batches run, and the limits a run is judged against.">
          <Field label="Default Engine" name="defaultEngine" error={error}>
            <select id="setting-defaultEngine" className="select" value={settings.defaultEngine}
              onChange={(event) => update("defaultEngine", event.target.value as Engine)} disabled={disabled}>
              <option value="simulation">Simulation</option>
              <option value="mssql">SQL Server</option>
              <option value="postgres">PostgreSQL</option>
            </select>
          </Field>
          <Field label="Query Timeout (ms)" name="queryTimeoutMs" error={error}>
            <input id="setting-queryTimeoutMs" className="input" type="number" value={settings.queryTimeoutMs} onChange={num("queryTimeoutMs")} disabled={disabled} />
          </Field>
          <Field label="Max SQL Length (characters)" name="maxSqlLength" error={error}>
            <input id="setting-maxSqlLength" className="input" type="number" value={settings.maxSqlLength} onChange={num("maxSqlLength")} disabled={disabled} />
          </Field>
          <Field label="Measured Runs" name="measuredRuns" error={error}>
            <input id="setting-measuredRuns" className="input" type="number" min={1} max={20}
              value={settings.measuredRuns} onChange={num("measuredRuns")} disabled={disabled} />
            <small className="field-hint">
              Runs measured for each execution on a real database. Above 1, one warm-up run is added first and not
              counted. Each run really executes the SQL, so a procedure that writes data writes once per run.
            </small>
          </Field>
          <Field label="Target: Max Logical Reads" name="maxLogicalReads" error={error}>
            <input id="setting-maxLogicalReads" className="input" type="number" min={1} placeholder="Not set"
              value={settings.maxLogicalReads ?? ""} onChange={optionalNum("maxLogicalReads")} disabled={disabled} />
            <small className="field-hint">A run over this is marked OPTIMIZE. With all three empty, runs are judged against the grade C limits (5,000 reads, 1,000 ms).</small>
          </Field>
          <Field label="Target: Max Elapsed Time (ms)" name="maxElapsedMs" error={error}>
            <input id="setting-maxElapsedMs" className="input" type="number" min={1} placeholder="Not set"
              value={settings.maxElapsedMs ?? ""} onChange={optionalNum("maxElapsedMs")} disabled={disabled} />
            <small className="field-hint">A run over this is marked OPTIMIZE.</small>
          </Field>
          <Field label="Target: Max Scan Count" name="maxScanCount" error={error}>
            <input id="setting-maxScanCount" className="input" type="number" min={1} placeholder="Not set"
              value={settings.maxScanCount ?? ""} onChange={optionalNum("maxScanCount")} disabled={disabled} />
            <small className="field-hint">A run over this is marked OPTIMIZE.</small>
          </Field>
          <Field label="Live Execution" name="allowLiveExecution" error={error} full>
            <div className="checkbox-row">
              <span>Allow live execution against a real database</span>
              <input id="setting-allowLiveExecution" className="checkbox" type="checkbox" checked={settings.allowLiveExecution}
                onChange={(event) => update("allowLiveExecution", event.target.checked)} disabled={disabled} />
            </div>
            <small className="field-hint">Warning: when enabled, stored procedures run against the connected database and can change data. Leave off to use simulation only.</small>
          </Field>
      </Group>

      <Group id="privacy" title="Privacy and logging" description="What is written to the audit logs and what leaves this machine.">
          <Field label="SQL Logging" name="logSqlText" error={error}>
            <div className="checkbox-row">
              <span>Write SQL text to audit logs (off stores a hash and length only)</span>
              <input id="setting-logSqlText" className="checkbox" type="checkbox" checked={settings.logSqlText}
                onChange={(event) => update("logSqlText", event.target.checked)} disabled={disabled} />
            </div>
          </Field>
          <Field label="Privacy" name="allowTelemetry" error={error}>
            <div className="checkbox-row">
              <span>Allow telemetry</span>
              <input id="setting-allowTelemetry" className="checkbox" type="checkbox" checked={settings.allowTelemetry}
                onChange={(event) => update("allowTelemetry", event.target.checked)} disabled={disabled} />
            </div>
          </Field>
      </Group>

      <Group id="sharing" title="Sharing" description="Links that let someone without a login view one result.">
          <Field label="Share Link Lifetime (hours)" name="shareTtlHours" error={error}>
            <input id="setting-shareTtlHours" className="input" type="number" value={settings.shareTtlHours} onChange={num("shareTtlHours")} disabled={disabled} />
          </Field>
          <Field label="Keep Records (days)" name="retentionDays" error={error}>
            <input id="setting-retentionDays" className="input" type="number" min={1} max={3650} value={settings.retentionDays} onChange={num("retentionDays")} disabled={disabled} />
            <small className="field-hint">Audit records and run logs older than this are deleted when the server starts and once a day.</small>
          </Field>
      </Group>

      <div className="page-actions form-actions">
        <button type="button" className="button button-primary" onClick={() => void handleSave()} disabled={disabled}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
        {message && <p role="status" className="status-note">{message}</p>}
      </div>
      {error && error.field === null && <p role="alert" className="alert">{error.message}</p>}
    </>
  );
}
