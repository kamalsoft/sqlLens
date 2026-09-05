"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AppSettings = {
  provider: string;
  defaultModel: string;
  downloadDirectory: string;
  autoDownload: boolean;
  autoUpdateModels: boolean;
  maxConcurrentDownloads: number;
  temperature: number;
  contextWindow: number;
  apiKey: string;
  allowTelemetry: boolean;
};

const defaultSettings: AppSettings = {
  provider: "OpenAI",
  defaultModel: "gpt-4o-mini",
  downloadDirectory: "~/models",
  autoDownload: true,
  autoUpdateModels: true,
  maxConcurrentDownloads: 2,
  temperature: 0.2,
  contextWindow: 128000,
  apiKey: "",
  allowTelemetry: false,
};

import { AppShell } from "../../components/AppShell";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/appconfig", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load settings");
        return response.json() as Promise<AppSettings>;
      })
      .then((config) => setSettings(config))
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load settings");
      })
      .finally(() => setLoading(false));
  }, []);

  const updateField = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/appconfig", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to save settings");
      }

      setSettings(payload);
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

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
          <button type="button" className="button button-primary">
            Save Settings
          </button>
        </div>
      </header>

      <section className="panel panel-card">
        <div className="form-grid">
          <div className="field">
            <label className="label">Model Provider</label>
            <select
              value={settings.provider}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  provider: event.target.value,
                }))
              }
            >
              <option value="Hugging Face">Hugging Face</option>
            </select>
          </div>

          <div className="field">
            <label className="label">Default Model</label>
            <input
              value={settings.defaultModel}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  defaultModel: event.target.value,
                }))
              }
            />
          </div>

          <div className="field full">
            <label className="label">Download Directory</label>
            <input
              value={settings.downloadDirectory}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  downloadDirectory: event.target.value,
                }))
              }
            />
          </div>

          <div className="field">
            <label className="label">API Key</label>
            <input className="input" type="password" placeholder="••••••••••" />
          </div>

          <div className="field">
            <label className="label">Temperature</label>
            <input className="input" type="number" defaultValue={0.2} step={0.1} />
          </div>

          <div className="field">
            <label className="label">Context Window</label>
            <input className="input" type="number" defaultValue={128000} />
          </div>

          <div className="field">
            <label className="label">Max Concurrent Downloads</label>
            <input className="input" type="number" defaultValue={2} />
          </div>

          <div className="field">
            <label className="label">Download Behavior</label>
            <div className="checkbox-row">
              <span>Auto-download recommended models</span>
              <input className="checkbox" type="checkbox" defaultChecked />
            </div>
          </div>

          <div className="field">
            <label className="label">Model Updates</label>
            <div className="checkbox-row">
              <span>Auto-update installed models</span>
              <input className="checkbox" type="checkbox" defaultChecked />
            </div>
          </div>

          <div className="field">
            <label className="label">Privacy</label>
            <div className="checkbox-row">
              <span>Allow telemetry</span>
              <input className="checkbox" type="checkbox" />
            </div>
          </div>
        </div>
      </section>

      <button type="button" onClick={handleSave} disabled={loading || saving}>
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {message && <p>{message}</p>}
    </>
  );
}