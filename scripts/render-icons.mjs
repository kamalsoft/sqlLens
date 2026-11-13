// Rebuilds src/app/favicon.ico (16 + 32 px) and src/app/apple-icon.png (180 px) from src/app/icon.svg.
// Run after changing icon.svg: `npm run icons` (needs Playwright's Chromium: `npx playwright install chromium`).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("src/app/icon.svg", "utf8");
const browser = await chromium.launch();
async function png(size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  const image = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return image;
}

writeFileSync("src/app/apple-icon.png", await png(180));

// ICO with embedded PNG images: header, one 16-byte entry per image, then the images.
const images = [[16, await png(16)], [32, await png(32)]];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(([size, data]) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([header, ...entries, ...images.map(([, data]) => data)]));
await browser.close();
console.log("Wrote src/app/apple-icon.png and src/app/favicon.ico");
