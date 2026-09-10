/**
 * Light + dark screenshot pass for Phase 9 polish surfaces
 * (editors, settings nav, servers, deployments, monitoring).
 *
 * Usage (dev server on :3000):
 *   cd tools/screenshots && SMOKE_EMAIL=... SMOKE_PASSWORD=... node phase9-capture.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const OUT = new URL("./out/phase9/", import.meta.url).pathname;
const CHROME =
	process.env.PLAYWRIGHT_CHROME ??
	`${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
	headless: true,
	executablePath: CHROME,
});
const page = await browser.newPage({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
});

const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(String(err)));

async function setTheme(mode) {
	await page.evaluate((next) => {
		localStorage.setItem("theme", next);
		document.documentElement.classList.toggle("dark", next === "dark");
		document.documentElement.style.colorScheme = next;
	}, mode);
	await page.waitForTimeout(400);
}

async function shot(name) {
	await page.waitForTimeout(800);
	await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
	console.log("captured", name);
}

async function login() {
	await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
	await page.getByLabel(/email/i).fill(EMAIL);
	await page.locator('input[type="password"]').first().fill(PASSWORD);
	await page.getByRole("button", { name: /sign in|log in/i }).click();
	await page.waitForURL(/dashboard/i, { timeout: 30_000 });
	await page.waitForLoadState("networkidle");
}

try {
	await login();

	for (const theme of ["light", "dark"]) {
		await setTheme(theme);
		const t = theme;

		await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
		await shot(`${t}-01-dashboard`);

		await page.goto(`${BASE}/dashboard/settings/servers`, { waitUntil: "networkidle" });
		await shot(`${t}-02-servers`);

		await page.goto(`${BASE}/dashboard/settings/server`, { waitUntil: "networkidle" });
		await shot(`${t}-03-web-server`);

		await page.goto(`${BASE}/dashboard/settings/profile`, { waitUntil: "networkidle" });
		await shot(`${t}-04-settings-nav`);

		const projectLink = page.locator('a[href*="/dashboard/projects/"]').first();
		await page.goto(`${BASE}/dashboard/projects`, { waitUntil: "networkidle" }).catch(() => {});
		// Prefer first project from dashboard
		await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
		const link = page.locator('a[href*="/dashboard/projects/"]').first();
		if (await link.count()) {
			await link.click();
			await page.waitForLoadState("networkidle");
			await shot(`${t}-05-project`);

			// Environment / variables tab if present
			const envTab = page.getByRole("tab", { name: /environment|variables/i });
			if (await envTab.count()) {
				await envTab.first().click();
				await page.waitForTimeout(1000);
				await shot(`${t}-06-env`);
			}

			const serviceLink = page
				.locator(
					'a[href*="/services/application/"], a[href*="/services/compose/"], a[href*="/services/postgres/"]',
				)
				.first();
			if (await serviceLink.count()) {
				await serviceLink.click();
				await page.waitForLoadState("networkidle");
				await shot(`${t}-07-service`);

				for (const tab of ["Deployments", "Environment", "Logs", "Monitoring", "Terminal"]) {
					const tabEl = page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") });
					if (await tabEl.count()) {
						await tabEl.first().click();
						await page.waitForTimeout(1500);
						await shot(`${t}-08-${tab.toLowerCase()}`);
					}
				}

				// Compose file tab when present
				const composeTab = page.getByRole("tab", { name: /^compose/i });
				if (await composeTab.count()) {
					await composeTab.first().click();
					await page.waitForTimeout(1200);
					await shot(`${t}-09-compose-file`);
				}
			}
		}
	}

	if (consoleErrors.length) {
		console.warn("pageerrors:", consoleErrors.slice(0, 10));
	}
} finally {
	await browser.close();
}
console.log("done ->", OUT);
