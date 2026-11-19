import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
const pinned = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(existsSync(pinned) ? { executablePath: pinned } : {});
const base = "http://127.0.0.1:5199/tests/preview/admin-dashboard.html?state=";
const rect = (page, sel) => page.$$eval(sel, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }));
async function open(state, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "light" });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(base + state, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return page;
}
for (const [w, h] of [[1440, 2586], [834, 3244], [390, 5580], [320, 3000]]) {
  const p = await open("default", w, h);
  console.log(w, "intro", JSON.stringify(await rect(p, "header:has(h1)")), "btns", JSON.stringify(await rect(p, "header:has(h1) button")));
  console.log(w, "kpi", JSON.stringify(await rect(p, 'ul[aria-label="Portfolio KPIs"] > li > *')));
  console.log(w, "docW", await p.evaluate(() => document.documentElement.scrollWidth));
  await p.close();
}
{
  const p = await open("quick-add", 1440, 2586);
  console.log("menu group", JSON.stringify(await rect(p, '[role="menu"] [role="group"]')), "dismiss", JSON.stringify(await rect(p, '[role="menuitem"][aria-label]')));
  await p.close();
}
for (const [st, sel] of [["loading", '[aria-busy="true"] > div'], ["empty", "main section"], ["error", '[role="alert"]'], ["success", '[role="status"]']]) {
  for (const w of [1440, 390]) {
    const p = await open(st, w, 2000);
    console.log(st, w, JSON.stringify(await rect(p, sel)), st === "success" ? JSON.stringify(await rect(p, 'ul[aria-label="Portfolio KPIs"]')) : "");
    await p.close();
  }
}
await browser.close();
