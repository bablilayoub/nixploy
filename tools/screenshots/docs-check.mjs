import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

// Every docs page, since the duplicate-key collision was per page.
await page.goto("http://localhost:3001/docs", { waitUntil: "load" });
await page.waitForTimeout(800);
const slugs = await page.evaluate(() =>
	[...document.querySelectorAll('a[href^="/docs/"]')].map((a) => a.getAttribute("href")).filter((v, i, arr) => arr.indexOf(v) === i),
);
for (const slug of slugs) {
	await page.goto(`http://localhost:3001${slug}`, { waitUntil: "load" });
	await page.waitForTimeout(350);
}
await browser.close();
console.log(JSON.stringify({ pages: slugs.length, problems }, null, 1));
