/**
 * Landing asset capture → apps/landing/public/screenshots
 * Requires panel on BASE_URL with dev admin account.
 *   cd tools/screenshots && BASE_URL=http://localhost:3100 node landing-assets.mjs
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = join(__dirname, "../../apps/landing/public/screenshots");
mkdirSync(OUT, { recursive: true });

const PROJECT = "afe5674c-9428-4da7-9280-3d108bc0402b";
const COMPOSE = "623c31d1-362d-4d11-b097-41af1c92502f";
const ENV = "dcb586b9-658c-4237-b5f5-52d4c29ad13f";

const chrome = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	colorScheme: "dark",
});
const page = await context.newPage();
await page.addInitScript(() => {
	localStorage.setItem("theme", "dark");
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', requireEnv("SMOKE_EMAIL"));
await page.fill('input[type="password"]', requireEnv("SMOKE_PASSWORD"));
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20_000 });
await page.waitForTimeout(1500);
// Dismiss any toasts so they don't appear in shots.
await page.evaluate(() => {
	document.querySelectorAll("[data-sonner-toast], .sonner-toast, [data-sonner-toaster]").forEach((el) => el.remove());
});
console.log("logged in");

async function shot(file, path, { scroll = 0, tab } = {}) {
	await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
	await page.waitForTimeout(1800);
	if (tab) {
		await page.getByRole("tab", { name: tab }).click();
		await page.waitForTimeout(1000);
	}
	await page.evaluate(() => {
		document.querySelectorAll("[data-sonner-toast], .sonner-toast, [data-sonner-toaster]").forEach((el) => el.remove());
	});
	if (scroll) {
		await page.evaluate((y) => window.scrollTo(0, y), scroll);
		await page.waitForTimeout(400);
	}
	await page.screenshot({ path: join(OUT, file) });
	console.log("shot", file);
}

await shot("02-dashboard.png", "/dashboard");
await shot("03-project.png", `/dashboard/projects/${PROJECT}?environmentId=${ENV}`);
await shot(
	"04-service.png",
	`/dashboard/projects/${PROJECT}/services/compose/${COMPOSE}?environmentId=${ENV}`,
);
await shot(
	"05-deployments.png",
	`/dashboard/projects/${PROJECT}/services/compose/${COMPOSE}?environmentId=${ENV}`,
	{ tab: /deploy/i },
);
await shot("06-monitoring.png", "/dashboard/monitoring");
await shot("07-templates.png", "/dashboard/templates");

await browser.close();
console.log("done →", OUT);
