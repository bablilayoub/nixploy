import { chromium } from "playwright-core";

const out = process.env.OUT_DIR ?? "out";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

const shots = [
	["home-features", "/", "#features"],
	["home-security", "/", "#security"],
	["home-pricing", "/", "#pricing"],
	["home-cta", "/", null],
	["compare", "/compare", null],
	["templates", "/templates", null],
	["docs", "/docs", null],
	["agents", "/agents", null],
	["features-page", "/features", null],
];

for (const [name, path, anchor] of shots) {
	await page.goto(`http://localhost:3001${path}`, { waitUntil: "load" });
	await page.waitForTimeout(1200);
	if (anchor) {
		await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView(), anchor);
	} else if (name === "home-cta") {
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	}
	await page.waitForTimeout(1800);
	await page.screenshot({ path: `${out}/r-${name}.png` });
}
await browser.close();
console.log(JSON.stringify({ problems }, null, 2));
