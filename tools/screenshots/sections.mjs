import { chromium } from "playwright-core";

/*
 * Viewport-sized slices of the landing home page against a running dev server
 * (`pnpm --filter @nixploy/landing dev`, :3001). Desktop 1440x900 at 1x, one
 * slice every 900px down the page, plus the same walk on a phone. The page is
 * walked once first so every in-view animation has fired. Reports horizontal
 * overflow and console errors on stdout.
 *
 *   OUT_DIR=/tmp/shots node tools/screenshots/sections.mjs
 */
const out = process.env.OUT_DIR ?? "out";
const base = process.env.BASE_URL ?? "http://localhost:3001";
const browser = await chromium.launch({ headless: true });
const problems = [];

async function walk(page, prefix, step) {
	await page.goto(base, { waitUntil: "load" });
	await page.waitForTimeout(1500);
	const total = await page.evaluate(() => document.documentElement.scrollHeight);
	for (let y = 0; y < total; y += 400) {
		await page.evaluate((top) => window.scrollTo(0, top), y);
		await page.waitForTimeout(180);
	}
	await page.waitForTimeout(1200);
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	let index = 0;
	for (let y = 0; y < height; y += step) {
		await page.evaluate((top) => window.scrollTo(0, top), y);
		await page.waitForTimeout(900);
		await page.screenshot({ path: `${out}/${prefix}-${String(index).padStart(2, "0")}.png` });
		index++;
	}
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth + 1,
	);
	return { height, slices: index, overflow };
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
desktop.on("console", (m) => {
	if (m.type() === "error") problems.push(m.text().slice(0, 240));
});
desktop.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
const d = await walk(desktop, "d", 900);

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
mobile.on("pageerror", (e) => problems.push(`mobile pageerror: ${e.message}`));
const m = await walk(mobile, "m", 1600);

await browser.close();
console.log(JSON.stringify({ desktop: d, mobile: m, problems }));
