import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@/lib/theme-tokens";

const app = (f: string) => path.join(process.cwd(), "src", "app", f);

describe("logo and favicons (LG-2)", () => {
  it("icon.svg uses the dark theme's canvas and accent colours", () => {
    const svg = readFileSync(app("icon.svg"), "utf8");
    const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g)!.map((c) => c.toUpperCase()));
    const dark = TOKENS.dark;
    expect(colours).toEqual(new Set([dark["bg.canvas"], dark["accent.default"], dark["accent.solid"]].map((c) => c.toUpperCase())));
    expect(svg).toContain('viewBox="0 0 64 64"');
  });

  // favicon.ico and apple-icon.png are rendered from icon.svg: run `npm run icons` after changing it.
  // LogoMark (src/components/Logo.tsx) is the same drawing with theme variables; keep the two in step.
  it("favicon.ico holds 16 and 32 px PNG images; apple-icon.png is 180 px", () => {
    const ico = readFileSync(app("favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1); // icon type
    expect(ico.readUInt16LE(4)).toBe(2); // two images
    expect([ico[6], ico[22]]).toEqual([16, 32]);
    const png = readFileSync(app("apple-icon.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]);
  });
});
