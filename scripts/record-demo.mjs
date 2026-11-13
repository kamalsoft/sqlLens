// Records the README demo walkthrough as a .webm in <outDir>.
// Usage: DEMO_USER=... DEMO_PASS=... node scripts/record-demo.mjs <outDir>
//   BASE_URL      app to record (default http://localhost:3000)
//   DEMO_ANALYZE  set to 1 to click Analyze on Review (only with SQLLENS_FAKE_INFERENCE=1 on the server)
import { chromium } from "@playwright/test";

const { DEMO_USER, DEMO_PASS, BASE_URL = "http://localhost:3000", DEMO_ANALYZE } = process.env;
const outDir = process.argv[2];
if (!DEMO_USER || !DEMO_PASS || !outDir) {
  console.error("Usage: DEMO_USER=... DEMO_PASS=... node scripts/record-demo.mjs <outDir>");
  process.exit(1);
}

const size = { width: 1280, height: 720 };
const SAMPLE_SQL = `CREATE PROCEDURE dbo.GetOrders
  @CustomerId int
AS
BEGIN
  SELECT * FROM dbo.Orders
  WHERE CustomerId = @CustomerId;
END`;

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: BASE_URL, viewport: size, recordVideo: { dir: outDir, size } });
const page = await context.newPage();
const pause = (ms = 2500) => page.waitForTimeout(ms);
const nav = page.getByRole("navigation", { name: "Sidebar navigation" });

try {
  await page.goto("/login");
  await page.fill('[name="username"]', DEMO_USER);
  await page.fill('[name="password"]', DEMO_PASS);
  await pause(800);
  await page.click('[type="submit"]');
  await nav.waitFor();
  await pause();

  await nav.getByRole("link", { name: "Review SP" }).click();
  await page.locator(".cm-content").first().click();
  await page.keyboard.type(SAMPLE_SQL, { delay: 15 });
  await pause(1500);
  if (DEMO_ANALYZE === "1") {
    await page.getByRole("button", { name: /analy[sz]e/i }).click();
    await page.getByRole("region", { name: "Analysis results" }).waitFor({ timeout: 60_000 });
    await pause(4000);
  }

  // Feature-flagged pages (Compare, Refactor) are left out so the script works on any config.
  for (const name of ["Execute & Audit SP", "Audit", "Manage Models", "Help", "Overview"]) {
    // Suffix match: link names start with an icon glyph, and "Audit" must not match "Execute & Audit SP".
    await nav.getByRole("link", { name: new RegExp(`${name}$`) }).click();
    await page.waitForLoadState("networkidle");
    await pause();
  }
} finally {
  await context.close(); // flushes the video file
  await browser.close();
}
console.log(await page.video().path());
