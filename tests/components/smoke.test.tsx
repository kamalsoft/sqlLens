// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("component test environment", () => {
  it("renders JSX into jsdom with jest-dom matchers", () => {
    render(<button type="button" disabled>Save</button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
