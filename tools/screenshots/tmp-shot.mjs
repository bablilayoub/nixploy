import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const y = Number(process.argv[4] ?? 0);
if (y) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(900); }
await page.screenshot({ path: process.argv[3] });
await browser.close();
console.log("saved", process.argv[3]);
