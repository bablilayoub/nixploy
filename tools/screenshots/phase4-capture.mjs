/**
 * Phase 4/4C verification screenshots (light + dark).
 * Requires nixploy web on BASE_URL and the dev admin account.
 *
 *   cd tools/screenshots && BASE_URL=http://localhost:3100 node phase4-capture.mjs
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const OUT = join(__dirname, "out/phase4");
mkdirSync(OUT, { recursive: true });

const PROJECT = "afe5674c-9428-4da7-9280-3d108bc0402b";
const COMPOSE = "623c31d1-362d-4d11-b097-41af1c92502f";
const ENV = "dcb586b9-658c-4237-b5f5-52d4c29ad13f";

const chrome = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
try {
	await page.waitForURL(/dashboard/, { timeout: 20_000 });
} catch {
	console.log("no redirect; url =", page.url());
	await page.screenshot({ path: join(OUT, "login-debug.png") });
	throw new Error("login failed");
}
console.log("logged in");

async function setTheme(theme) {
	await page.evaluate((t) => {
		localStorage.setItem("theme", t);
		document.documentElement.classList.toggle("dark", t === "dark");
		document.documentElement.style.colorScheme = t;
	}, theme);
}

async function shot(name, path, { theme, before, fullPage } = {}) {
	await setTheme(theme);
	await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
	await page.waitForTimeout(1200);
	if (before) await before();
	await page.screenshot({ path: join(OUT, `${name}-${theme}.png`), fullPage: !!fullPage });
	console.log(`shot ${name}-${theme}`);
}

const composePath = `/dashboard/projects/${PROJECT}/services/compose/${COMPOSE}?environmentId=${ENV}`;

for (const theme of ["dark", "light"]) {
	await shot("compose-file", composePath, {
		theme,
		before: async () => {
			await page.getByRole("tab", { name: /compose file/i }).click();
			await page.waitForTimeout(800);
		},
	});
	// Generate with Copilot dialog
	try {
		await page.getByRole("button", { name: /generate with copilot/i }).first().click({ timeout: 4000 });
		await page.waitForTimeout(600);
		await page.screenshot({ path: join(OUT, `compose-generate-dialog-${theme}.png`) });
		console.log(`shot compose-generate-dialog-${theme}`);
		await page.keyboard.press("Escape");
	} catch {
		console.log(`generate dialog button not found (${theme})`);
	}
	await shot("settings-organization", "/dashboard/settings/organization", { theme, fullPage: true });
	await shot("monitoring", "/dashboard/monitoring", { theme });
	await shot("settings-servers", "/dashboard/settings/servers", { theme });
}

await browser.close();
console.log("done →", OUT);
