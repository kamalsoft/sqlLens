// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/audit",
  useParams: () => ({ id: "rec1" }),
}));

import AuditListPage from "@/app/audit/page";
import AuditDetailPage from "@/app/audit/[id]/page";
import SharePage from "@/app/share/[token]/page";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base = {
  id: "rec1", createdAt: "2026-01-01T00:00:00Z", engine: "simulation", simulated: true,
  status: "ok", recordNumber: 7, schemaVersion: "v2", modelId: "m1", feedback: {},
};

const v2 = {
  summary: "S", overallRisk: "high", confidence: 0.7,
  findingsTable: [
    { category: "security", finding: "Find-A", evidence: "e", severity: "high", recommendation: "Do A" },
    { category: "performance", finding: "Find-B", evidence: "e", severity: "low", recommendation: "Do B" },
  ],
  performanceTable: [], securityTable: [], testingTable: [], rewrittenProcedure: "SELECT 1", limitations: [],
};

function mockRecord(record: unknown, extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url === "/api/audit/rec1") return json(200, record);
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); router.replace.mockClear(); });

describe("audit history list", () => {
  it("shows type, record, engine, simulated and shared indicators with links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { audits: [
      { id: "a1", type: "EXECUTE", createdAt: "2026-01-01T00:00:00Z", engine: "simulation", simulated: true, status: "ok", recordNumber: 3, hasShare: true },
      { id: "a2", type: "REVIEW", createdAt: "2026-01-02T00:00:00Z", engine: null, simulated: false, status: "ok", recordNumber: 4, hasShare: false },
    ] })));
    render(<AuditListPage />);
    const table = await screen.findByRole("table", { name: "Audit history" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByRole("link", { name: "#3" })).toHaveAttribute("href", "/audit/a1");
    expect(within(rows[1]).getByText("Simulated")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Shared")).toBeInTheDocument();
    expect(within(rows[2]).queryByText("Simulated")).toBeNull();
    expect(within(rows[2]).queryByText("Shared")).toBeNull();
  });
});

describe("audit detail", () => {
  it("reopens a REVIEW record and PATCHes feedback", async () => {
    const fetchMock = mockRecord({ ...base, type: "REVIEW", response: { result: v2 } });
    render(<AuditDetailPage />);
    expect(await screen.findByLabelText("Review result v2")).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "Feedback findingsTable:0" });
    fireEvent.click(within(group).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(within(group).getByRole("button", { name: "Accept" })).toHaveAttribute("aria-pressed", "true"));

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/audit/rec1/recommendations");
    expect(JSON.parse(patch[1].body)).toEqual({ items: [{ key: "findingsTable:0", status: "accepted", note: "" }] });

    fireEvent.change(screen.getByLabelText("Note findingsTable:1"), { target: { value: "later" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note findingsTable:1" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => i?.method === "PATCH")).toHaveLength(2));
    const second = fetchMock.mock.calls.filter(([, i]) => i?.method === "PATCH")[1];
    expect(JSON.parse(second[1].body).items[0]).toEqual({ key: "findingsTable:1", status: "pending", note: "later" });
  });

  it("rolls back feedback and shows the error when PATCH fails", async () => {
    mockRecord({ ...base, type: "REVIEW", response: { result: v2 } }, (_u, init) =>
      init?.method === "PATCH" ? json(500, { error: "Internal error" }) : undefined);
    render(<AuditDetailPage />);
    await screen.findByLabelText("Review result v2");
    const group = screen.getByRole("group", { name: "Feedback findingsTable:0" });
    fireEvent.click(within(group).getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Internal error");
    expect(within(group).getByRole("button", { name: "Reject" })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: "Pending" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders EXECUTE metrics with null as not captured", async () => {
    mockRecord({ ...base, type: "EXECUTE", response: { mode: "single", analysis: {
      performanceGrade: null, ioAnalysis: { totalLogicalReads: 120, totalPhysicalReads: null, totalScanCount: null }, timeAnalysis: { totalMs: null },
    } } });
    render(<AuditDetailPage />);
    const section = await screen.findByLabelText("Execution metrics");
    expect(within(section).getByText("120")).toBeInTheDocument();
    expect(within(section).getAllByText("not captured")).toHaveLength(4);
    expect(screen.getByText("Simulated")).toBeInTheDocument();
  });

  it("renders EXECUTE_COMPARE before/after table with null metrics", async () => {
    mockRecord({ ...base, type: "EXECUTE_COMPARE", response: { mode: "compare", comparison: { metrics: {
      logicalReads: { original: 1000, optimized: 400, delta: -600, deltaPct: -60 },
      physicalReads: { original: null, optimized: null, delta: null, deltaPct: null },
      scanCount: { original: 3, optimized: 1, delta: -2, deltaPct: -66.7 },
      cpu: { original: null, optimized: 5, delta: null, deltaPct: null },
      elapsed: { original: 10, optimized: 5, delta: -5, deltaPct: -50 },
    } } } });
    render(<AuditDetailPage />);
    const table = await screen.findByRole("table", { name: "Metric comparison" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("-60.0%")).toBeInTheDocument();
    expect(within(rows[2]).getAllByText("not captured")).toHaveLength(4);
    expect(within(rows[4]).getAllByText("not captured")).toHaveLength(3);
  });

  it("renders a COMPARE summary", async () => {
    mockRecord({ ...base, type: "COMPARE", response: { summary: "Optimized is faster", verdict: "Ship it", recommendations: ["Add index"] } });
    render(<AuditDetailPage />);
    expect(await screen.findByText("Optimized is faster")).toBeInTheDocument();
    expect(screen.getByText("Add index")).toBeInTheDocument();
  });

  it("creates, copies and revokes a share link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const fetchMock = mockRecord({ ...base, type: "COMPARE", response: { summary: "x" } }, (url, init) => {
      if (url === "/api/audit/rec1/share" && init?.method === "POST") return json(200, { url: "/share/tok", expiresAt: "2026-02-01T00:00:00Z" });
      if (url === "/api/audit/rec1/share" && init?.method === "DELETE") return json(200, { success: true });
      return undefined;
    });
    render(<AuditDetailPage />);
    await screen.findByText("x");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share record" });
    fireEvent.change(within(dialog).getByLabelText(/Link lifetime/), { target: { value: "48" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Create link" })); });

    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ ttlHours: 48 });
    const input = (await within(dialog).findByLabelText("Share link")) as HTMLInputElement;
    expect(input.value).toMatch(/\/share\/tok$/);

    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Copy link" })); });
    expect(writeText).toHaveBeenCalledWith(input.value);

    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Revoke link" })); });
    expect(await within(dialog).findByText("Share link revoked.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Share link")).toBeNull();
  });
});

describe("share page", () => {
  const renderShare = () =>
    render(<ChakraProvider value={defaultSystem}><SharePage params={Promise.resolve({ token: "t" })} /></ChakraProvider>);

  it("shows 404 message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: "Shared result not found" })));
    renderShare();
    expect(await screen.findByText("Link not found or revoked.")).toBeInTheDocument();
  });

  it("shows 410 message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(410, { error: "Share link has expired" })));
    renderShare();
    expect(await screen.findByText("Link expired.")).toBeInTheDocument();
  });

  it("shows expiresAt on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, {
      id: "x", type: "OTHER", createdAt: "2026-01-01T00:00:00Z", result: {}, expiresAt: "2030-01-01T00:00:00Z",
    })));
    renderShare();
    expect(await screen.findByText(/^Expires /)).toBeInTheDocument();
  });
});
