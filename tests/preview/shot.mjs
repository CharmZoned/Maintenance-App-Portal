// Screenshot the admin dashboard preview.
//   node tests/preview/shot.mjs <state> <width> <height> <out.png> [baseUrl]
// Requires `pnpm dev` (or `pnpm exec vite --port 5199`) to be running.
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const [state = "default", width = "1440", height = "2586", out = "shot.png", base = "http://127.0.0.1:5199"] =
  process.argv.slice(2);

// Cloud containers ship one Chromium at a fixed path; elsewhere use Playwright's own.
const pinned = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(existsSync(pinned) ? { executablePath: pinned } : {});
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
page.on("pageerror", (err) => console.error("[pageerror]", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("[console.error]", msg.text());
});
await page.goto(`${base}/tests/preview/admin-dashboard.html?state=${state}`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
