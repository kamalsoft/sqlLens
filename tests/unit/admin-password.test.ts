import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, applyKeys, mismatchProblem, passwordProblem } from "@/lib/admin-password";

describe("passwordProblem", () => {
  it("rejects a password one character short and accepts the minimum length", () => {
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least 12 characters/);
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });
});

describe("mismatchProblem", () => {
  it("reports a repeat that differs and accepts an identical one", () => {
    expect(mismatchProblem("correct horse", "correct hors")).toBe("Passwords do not match.");
    expect(mismatchProblem("correct horse", "correct horse")).toBeNull();
  });
});

describe("applyKeys", () => {
  it("shows one * per typed character and keeps the characters", () => {
    expect(applyKeys("", "ab")).toEqual({ value: "ab", echo: "**", done: false, cancelled: false });
  });

  it("backspace removes the last character and erases one mask", () => {
    expect(applyKeys("abc", "\u007f")).toEqual({ value: "ab", echo: "\b \b", done: false, cancelled: false });
  });

  it("backspace on an empty value does nothing", () => {
    expect(applyKeys("", "\b")).toEqual({ value: "", echo: "", done: false, cancelled: false });
  });

  it("Enter finishes the entry with the value typed so far", () => {
    expect(applyKeys("secret", "\r")).toEqual({ value: "secret", echo: "", done: true, cancelled: false });
  });

  it("a pasted password followed by Enter finishes in one chunk", () => {
    expect(applyKeys("", "longpassword1\r")).toEqual({ value: "longpassword1", echo: "*".repeat(13), done: true, cancelled: false });
  });

  it("Ctrl+C cancels the entry", () => {
    expect(applyKeys("abc", "\u0003")).toMatchObject({ done: true, cancelled: true });
  });

  it("ignores arrow keys and other escape sequences", () => {
    expect(applyKeys("abc", "\u001b[A")).toEqual({ value: "abc", echo: "", done: false, cancelled: false });
  });
});
