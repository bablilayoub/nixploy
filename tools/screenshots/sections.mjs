import { chromium } from "playwright-core";

const out = process.env.OUT_DIR ?? "out";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:3001", { waitUntil: "load" });
await page.waitForTimeout(1500);

// Walk once so every in-view animation has fired.
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += 600) {
	await page.evaluate((top) => window.scrollTo(0, top), y);
	await page.waitForTimeout(280);
}
await page.waitForTimeout(900);

const shots = [
	["hero", null, 0],
	["panel", null, 760],
	["statement", null, 1300],
	["features", "#features", 0],
	["agents", "#agents", 0],
	["templates", "#templates", 0],
	["positioning", "#positioning", 0],
	["opensource", "#open-source", 0],
];

for (const [name, sel, y] of shots) {
	if (sel) {
		await page.evaluate((s) => {
			const el = document.querySelector(s);
			if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24);
		}, sel);
	} else {
		await page.evaluate((top) => window.scrollTo(0, top), y);
	}
	await page.waitForTimeout(700);
	await page.screenshot({ path: `${out}/s-${name}.png` });
}

await browser.close();
console.log(JSON.stringify({ total, problems }));
