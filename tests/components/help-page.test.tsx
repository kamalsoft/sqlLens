// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";
import { existsSync } from "node:fs";
import path from "node:path";

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

  it("shows only the chosen tab: switching hides the previous panel", async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(await screen.findByRole("region", { name: "Using SQLLens" })).toBeVisible();
    // jsdom fires no animationend, so it cannot show the hiding itself (checked in a real browser);
    // it can show that About is closed and FAQ is open.
    expect(document.querySelector('[role="tabpanel"][id$="about"]')).toHaveAttribute("data-state", "closed");
    expect(document.querySelector('[role="tabpanel"][id$="faq"]')).toHaveAttribute("data-state", "open");
    // Regression: an animation on the panel element itself made Chakra wait for an animation end
    // that never came, so the old panel stayed visible. The fade must sit on an inner wrapper.
    expect(document.querySelectorAll('[role="tabpanel"].help-panel')).toHaveLength(0);
  });

  it("links only to files that exist, on the exact GitHub repository", async () => {
    const user = userEvent.setup();
    view();
    const hrefs = new Set<string>();
    for (const tab of ["About", "Architecture", "FAQ"]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      for (const summary of document.querySelectorAll("details summary")) (summary as HTMLElement).click();
      document.querySelectorAll("a[href^='https://']").forEach((a) => hrefs.add(a.getAttribute("href")!));
    }
    expect(hrefs.size).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) {
      expect(href.startsWith("https://github.com/kamalsoft/sqlLens/blob/main/")).toBe(true);
      const file = href.replace("https://github.com/kamalsoft/sqlLens/blob/main/", "");
      expect(existsSync(path.join(process.cwd(), file)), file).toBe(true);
    }
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
