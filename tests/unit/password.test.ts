import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password", () => {
  it("hashes in the scrypt format and verifies", () => {
    const h = hashPassword("a-long-password-123");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    expect(verifyPassword("a-long-password-123", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("uses a unique salt", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
  it.each(["simulated_hash", "n/a", "!disabled", "", "scrypt$1$2", "scrypt$a$b$c$d$e"])(
    "rejects %j",
    (stored) => {
      expect(verifyPassword("anything", stored)).toBe(false);
    }
  );
});
