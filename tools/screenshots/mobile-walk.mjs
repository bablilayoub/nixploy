import { chromium } from "playwright-core";

const out = process.env.OUT_DIR ?? "out";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:3001", { waitUntil: "load" });
await page.waitForTimeout(1500);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += 500) {
	await page.evaluate((top) => window.scrollTo(0, top), y);
	await page.waitForTimeout(220);
}
await page.waitForTimeout(900);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/m-full.png`, fullPage: true });

const spots = [["fold", 0], ["panel", 900], ["features", 2400], ["included", 6000]];
for (const [name, y] of spots) {
	await page.evaluate((top) => window.scrollTo(0, top), y);
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${out}/m-${name}.png` });
}
await browser.close();
console.log(JSON.stringify({ total, problems }));
