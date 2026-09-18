import { chromium } from "playwright-core";

const out = process.env.OUT_DIR ?? "out";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:3001", { waitUntil: "load" });
await page.waitForTimeout(1500);

// Walk the page one viewport at a time so every BlurFade has entered view.
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += 700) {
	await page.evaluate((top) => window.scrollTo(0, top), y);
	await page.waitForTimeout(450);
}
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/flow-full.png`, fullPage: true });

await page.evaluate(() => document.querySelector("#showcase")?.scrollIntoView());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/flow-showcase.png` });

await page.evaluate(() => document.querySelector("#how-it-works")?.scrollIntoView());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/flow-howitworks.png` });

const sections = await page.evaluate(() =>
	[...document.querySelector("main").children].map((el) => ({
		id: el.id || null,
		top: Math.round(el.getBoundingClientRect().top + window.scrollY),
		height: Math.round(el.getBoundingClientRect().height),
	})),
);
await browser.close();
console.log(JSON.stringify({ total, problems, sections }, null, 1));
