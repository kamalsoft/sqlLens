// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "./user";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/settings",
}));

import SettingsPage from "@/app/settings/page";

const loaded = {
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
  apiKey: "legacy-secret",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.replace.mockClear();
});

describe("SettingsPage", () => {
  it("renders controlled fields from GET and no API key field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, loaded)));
    const user = userEvent.setup();
    render(<SettingsPage />);

    const timeout = (await screen.findByLabelText("Query Timeout (ms)")) as HTMLInputElement;
    await waitFor(() => expect(timeout).toBeEnabled());
    expect(timeout.value).toBe("30000");
    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    fireEvent.change(timeout, { target: { value: "5000" } });
    expect(timeout.value).toBe("5000");

    const live = screen.getByLabelText("Live Execution") as HTMLInputElement;
    expect(live.checked).toBe(false);
    await user.click(live);
    expect(live.checked).toBe(true);
    expect(screen.getByText(/can\s+change data/)).toBeInTheDocument();
  });

  it("PUTs every field and never an apiKey", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json(200, loaded) : json(200, loaded)
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsPage />);

    const save = screen.getByRole("button", { name: "Save Settings" });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    const body = JSON.parse(put[1].body);
    expect(body).not.toHaveProperty("apiKey");
    for (const key of [
      "provider", "defaultModel", "downloadDirectory", "autoDownload", "autoUpdateModels",
      "maxConcurrentDownloads", "temperature", "contextWindow", "allowTelemetry",
      "allowLiveExecution", "queryTimeoutMs", "defaultEngine", "maxSqlLength",
      "inferenceTimeoutMs", "logSqlText", "shareTtlHours",
    ]) {
      expect(body).toHaveProperty(key);
    }
  });

  it("shows a 400 field error next to the field", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? json(400, { error: "queryTimeoutMs must be positive", field: "queryTimeoutMs" })
        : json(200, loaded)
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsPage />);

    const save = screen.getByRole("button", { name: "Save Settings" });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("queryTimeoutMs must be positive");
    expect(alert.id).toBe("setting-queryTimeoutMs-error");
  });
});
