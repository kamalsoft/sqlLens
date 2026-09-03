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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("sqlens-settings");
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as AppSettings;
      setSettings({ ...defaultSettings, ...parsed });
    } catch {
      // ignore invalid local storage content
    }
  }, []);

  const updateField = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleSave = () => {
    localStorage.setItem("sqlens-settings", JSON.stringify(settings));
    setSaved(true);

    window.setTimeout(() => setSaved(false), 1800);
  };

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
            <select className="select" defaultValue="OpenAI">
              <option>OpenAI</option>
              <option>Azure OpenAI</option>
              <option>Ollama</option>
              <option>Hugging Face</option>
            </select>
          </div>

          <div className="field">
            <label className="label">Default Model</label>
            <input className="input" defaultValue="gpt-4o-mini" />
          </div>

          <div className="field full">
            <label className="label">Download Directory</label>
            <input className="input" defaultValue="~/models" />
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
    </>
  );
}