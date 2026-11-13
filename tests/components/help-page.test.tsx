// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/help" }));

import HelpPage from "@/app/help/page";

const view = () => render(<ChakraProvider value={defaultSystem}><HelpPage /></ChakraProvider>);
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("Help page (HP-1)", () => {
  it("has About, Architecture and FAQ tabs, About first, with feature links and the DBA disclaimer", async () => {
    const user = userEvent.setup();
    view();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["About", "Architecture", "FAQ"]);
    expect(screen.getByRole("region", { name: "What SQLLens is" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Execute & Audit SP/ })).toHaveAttribute("href", "/execute");
    expect(screen.getByRole("region", { name: "What it does not do" })).toHaveTextContent(/Check with your DBA/);
    await user.click(screen.getByRole("tab", { name: "Architecture" }));
    // The diagram is an image with a title and a text description for screen readers.
    const diagram = await screen.findByRole("img", { name: "SQLLens architecture" });
    expect(diagram).toHaveAccessibleDescription(/SQL Server or PostgreSQL only when live execution is on/);
    for (const box of ["Browser", "Proxy", "API routes", "Execution", "Model output checks", "Model worker", "SQL Server / PostgreSQL", "SQLite database", "data/ folder", "audit_logs/", "Hugging Face"]) {
      expect(diagram.textContent).toContain(box);
    }
    expect(screen.getByRole("region", { name: "How a request flows" }).querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "security and compliance" })).toHaveAttribute("href", expect.stringContaining("docs/security.md"));
  });

  it("opens the tab named in ?tab=, with the FAQ questions", async () => {
    window.history.replaceState(null, "", "/help?tab=faq");
    view();
    expect(await screen.findByText("Will Execute & Audit SP change my database?")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "FAQ" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("group").length).toBeGreaterThanOrEqual(12);
    for (const topic of ["Using SQLLens", "AI and results", "Data and security"]) expect(screen.getByRole("region", { name: topic })).toBeInTheDocument();
  });
});
