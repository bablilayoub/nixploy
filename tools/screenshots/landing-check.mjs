import { chromium } from "playwright-core";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 1.5,
});
await page.goto("http://localhost:3001", { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.screenshot({ path: "out/landing-hero.png" });
await page.evaluate(() => document.querySelector("#features")?.scrollIntoView());
await page.waitForTimeout(1500);
await page.screenshot({ path: "out/landing-features.png" });
await page.evaluate(() => document.querySelector("#showcase")?.scrollIntoView());
await page.waitForTimeout(2500);
await page.screenshot({ path: "out/landing-showcase.png" });
await page.evaluate(() => document.querySelector("#deploy")?.scrollIntoView());
await page.waitForTimeout(1500);
await page.screenshot({ path: "out/landing-cta.png" });
await browser.close();
console.log("done");
