// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/refactor" }));

import RefactorPage from "@/app/refactor/page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const result = {
  summary: "Removed NOLOCK and SELECT *.",
  changes: ["Removed the NOLOCK hint"],
  indexRecommendations: [
    { table: "dbo.Orders", keyColumns: ["CustomerId"], includeColumns: [], reason: "Supports the filter", evidence: "", createStatement: "CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] ([CustomerId]);" },
  ],
  viewRecommendations: [{ name: "dbo.vOrders", reason: "Reused join", definition: "SELECT 1", createStatement: "CREATE VIEW [dbo].[vOrders]\nAS\nSELECT 1;" }],
  otherRecommendations: ["Update statistics"],
  limitations: ["No execution plan was provided"],
  status: "provided",
  refactoredSql: "CREATE PROCEDURE dbo.p\nAS\nBEGIN\n    SELECT 1;\nEND",
  formatted: true,
  checks: [
    { id: "sql", label: "Reads as T-SQL", passed: true },
    { id: "parameters", label: "Same parameters as the original", passed: false, detail: "Original: @id; refactored: none" },
  ],
};

function setup(refactor: () => Response) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) =>
    url === "/api/review/models" ? json({ models: [{ id: "m1", name: "Model One", compatible: true }] }) : refactor(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RefactorPage", () => {
  it("sends model, SQL and instructions, then renders SQL, checks and recommendations with copy", async () => {
    const fetchMock = setup(() => json({ id: "a1", result }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const user = userEvent.setup();
    render(<RefactorPage />);
    expect(await screen.findByRole("option", { name: "Model One" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/CREATE PROCEDURE dbo.GetOrders/), { target: { value: "SELECT 1" } });
    fireEvent.change(screen.getByPlaceholderText(/For example/), { target: { value: "Remove NOLOCK" } });
    await user.click(screen.getByRole("button", { name: "Refactor" }));

    expect(await screen.findByLabelText("Refactored SQL")).toHaveTextContent("CREATE PROCEDURE dbo.p");
    expect(screen.getByTestId("checks-failed")).toHaveTextContent("1 check(s) failed");
    expect(screen.getByText(/Original: @id; refactored: none/)).toBeInTheDocument();
    expect(screen.getByText("Index recommendations")).toBeInTheDocument();
    expect(screen.getByText("View recommendations")).toBeInTheDocument();
    expect(screen.getByText("Update statistics")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy refactored SQL" }));
    expect(writeText).toHaveBeenCalledWith(result.refactoredSql);
    expect(await screen.findByRole("button", { name: "Copy refactored SQL" })).toHaveTextContent("Copied");

    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u === "/api/refactor")![1].body);
    expect(body).toEqual({ modelId: "m1", sql: "SELECT 1", instructions: "Remove NOLOCK" });
  });

  it("explains a removed unsafe refactor", async () => {
    setup(() => json({ result: { ...result, status: "unsafe", statusDetail: "Writes to orders", refactoredSql: "", checks: [] } }));
    const user = userEvent.setup();
    render(<RefactorPage />);
    await screen.findByRole("option", { name: "Model One" });
    fireEvent.change(screen.getByPlaceholderText(/CREATE PROCEDURE dbo.GetOrders/), { target: { value: "SELECT 1" } });
    await user.click(screen.getByRole("button", { name: "Refactor" }));
    expect(await screen.findByTestId("refactor-status")).toHaveTextContent(/modifies data the original procedure does not\. \(Writes to orders\.\)/);
  });

  it("blocks non-SQL input and shows raw output on a 502", async () => {
    const fetchMock = setup(() => json({ error: "Unable to parse model response", details: { responseText: "not json" } }, 502));
    const user = userEvent.setup();
    render(<RefactorPage />);
    await screen.findByRole("option", { name: "Model One" });
    const box = screen.getByPlaceholderText(/CREATE PROCEDURE dbo.GetOrders/);
    fireEvent.change(box, { target: { value: "please optimize" } });
    await user.click(screen.getByRole("button", { name: "Refactor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not look like SQL/);
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/refactor")).toBe(false);

    fireEvent.change(box, { target: { value: "SELECT 1" } });
    await user.click(screen.getByRole("button", { name: "Refactor" }));
    expect(await screen.findByLabelText("Response preview")).toHaveTextContent("not json");
  });
});
